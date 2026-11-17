window.Views = window.Views || {};
(function () {
  'use strict';

  /** Goal detail: animated prerequisite map, topic list, sessions, mentor feedback. */
  Views.goal = async function ({ id, query }) {
    let data = await API.goal(id);
    let tab = 'map';
    let selectedId = query.topic || null;
    let fresh = new Set(), done = new Set();
    const root = h('div');

    const topicById = (tid) => data.topics.find((t) => t.id === tid);

    /* ---------- actions ---------- */
    async function complete(t, btn) {
      await UI.withBusy(btn, async () => {
        try {
          const r = await API.completeTopic(t.id);
          data = r;
          if (r.submitted) { UI.toast(`“${t.title}” submitted — waiting for ${data.goal.assignedByName || 'your mentor'} to approve`, 'info'); render(); return; }
          fresh = new Set(r.unlocked.map((u) => u.id));
          done = new Set([t.id]);
          const rect = btn.getBoundingClientRect();
          UI.confetti(rect.left + rect.width / 2, rect.top);
          UI.toast(r.unlocked.length ? `${t.title} complete — unlocked ${r.unlocked.map((u) => u.title).join(', ')}` : `${t.title} complete`);
          if (data.progress.percent === 100) setTimeout(() => UI.confetti(innerWidth / 2, innerHeight / 3), 500);
          render();
          setTimeout(() => { fresh = new Set(); done = new Set(); }, 4000);
        } catch (err) {
          if (err.code === 'LOCKED') {
            UI.toast(err.message, 'err');
            const el = document.querySelector('.drawer');
            if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
          } else UI.toast(err.message, 'err');
        }
      });
    }
    async function approve(t, btn) {
      await UI.withBusy(btn, async () => {
        try {
          const r = await API.approveTopic(t.id);
          data = r;
          const rect = btn.getBoundingClientRect(); UI.confetti(rect.left + rect.width / 2, rect.top);
          UI.toast(`Approved “${t.title}”`); App.refreshBadge && App.refreshBadge(); render();
        } catch (err) { UI.toast(err.message, 'err'); }
      });
    }
    function sendBack(t) {
      UI.modal((close) => {
        const ta = h('textarea', { class: 'textarea', maxlength: 300, rows: 4, placeholder: 'What should they fix or revisit?' });
        const btn = h('button', { class: 'btn danger', type: 'submit' }, Icon('undo'), 'Send back');
        const f = h('form', { novalidate: true }, UI.field('Feedback for the learner', ta, 'comment'), h('div', { class: 'foot' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), btn));
        f.addEventListener('submit', (e) => { e.preventDefault(); UI.withBusy(btn, async () => { try { data = await API.rejectTopic(t.id, ta.value); close(); UI.toast('Sent back with feedback', 'info'); App.refreshBadge && App.refreshBadge(); render(); } catch (err) { UI.applyApiError(f, err); } }); });
        return h('div', null, h('h2', null, `Send back “${t.title}”`), f);
      });
    }
    async function reopen(t) {
      const dependents = data.topics.filter((x) => x.complete && x.id !== t.id && Charts && isDependent(x, t.id));
      const policy = data.config.reopenPolicy;
      if (policy === 'cascade' && dependents.length) {
        const ok = await UI.confirm({ title: `Reopen “${t.title}”?`, body: `${dependents.map((d) => d.title).join(', ')} depend${dependents.length === 1 ? 's' : ''} on it, so ${dependents.length === 1 ? 'it' : 'they'} will be reopened and locked again until this is complete.`, confirmLabel: 'Reopen & re-lock', icon: 'undo' });
        if (!ok) return;
      }
      try {
        const r = await API.reopenTopic(t.id);
        data = r;
        UI.toast(r.relocked.length ? `Reopened — ${r.relocked.map((x) => x.title).join(', ')} locked again` : `${t.title} reopened`, 'info');
        render();
      } catch (err) {
        UI.toast(err.message, 'err');
      }
    }
    function isDependent(x, targetId) {
      const seen = new Set();
      const walk = (t) => t.prerequisites.some((p) => p === targetId || (!seen.has(p) && (seen.add(p), topicById(p) && walk(topicById(p)))));
      return walk(x);
    }
    async function removeTopic(t) {
      const ok = await UI.confirm({ title: `Delete “${t.title}”?`, body: 'Its study sessions are deleted too, and it is removed as a prerequisite from other topics.', confirmLabel: 'Delete topic', danger: true, icon: 'trash' });
      if (!ok) return;
      try {
        data = await API.deleteTopic(t.id);
        selectedId = null;
        UI.drawer.close();
        UI.toast('Topic deleted', 'info');
        render();
      } catch (err) {
        UI.toast(err.message, 'err');
      }
    }
    async function removeGoal() {
      const ok = await UI.confirm({ title: `Delete “${data.goal.title}”?`, body: 'All of its topics and study sessions will be permanently deleted.', confirmLabel: 'Delete goal', danger: true, icon: 'trash' });
      if (!ok) return;
      try {
        await API.deleteGoal(data.goal.id);
        UI.toast('Goal deleted', 'info');
        App.go('/');
      } catch (err) {
        UI.toast(err.message, 'err');
      }
    }
    const logFor = (t) => {
      const groups = [{ goalTitle: data.goal.title, color: data.goal.color, topics: data.topics.map((x) => ({ id: x.id, title: x.title, state: x.state, locked: x.locked, missing: x.missing })) }];
      Views.sessionModal({ groups, config: data.config, today: data.today, presetTopicId: t && t.id, onSaved: async () => { data = await API.goal(id); render(); } });
    };

    /* ---------- drawer ---------- */
    function openDrawer(t) {
      selectedId = t.id;
      UI.drawer.open(drawerBody(t), () => { selectedId = null; renderBody(); });
      renderBody();
    }
    function drawerBody(t) {
      const prereqs = t.prerequisites.map((pid) => topicById(pid)).filter(Boolean);
      const sess = data.sessions.filter((s) => s.topicId === t.id).slice(0, 5);
      const needsApproval = data.goal.requireApproval;
      const est = t.estimateMinutes;
      const pctEst = est ? Math.min(100, Math.round((t.minutes / est) * 100)) : 0;
      const banner = (icon, color, ...kids) => h('div', { class: 'banner', style: { marginTop: '16px', background: `color-mix(in srgb, var(--${color}) 11%, transparent)`, borderColor: `color-mix(in srgb, var(--${color}) 35%, transparent)` } }, Icon(icon), h('span', null, ...kids));
      const actions = [];
      if (data.canEdit) {
        if (t.state === 'pending') actions.push(h('button', { class: 'btn', onclick: () => reopen(t) }, Icon('undo'), 'Withdraw submission'));
        else if (t.complete) actions.push(h('button', { class: 'btn', onclick: () => reopen(t) }, Icon('undo'), 'Reopen'));
        else actions.push(h('button', { class: `btn ${t.locked ? '' : 'mint'}`, 'aria-disabled': t.locked ? 'true' : null, onclick: (e) => complete(t, e.currentTarget) }, Icon(t.locked ? 'lock' : needsApproval ? 'send' : 'check'), needsApproval ? 'Submit for approval' : 'Mark complete'));
        actions.push(h('button', { class: 'btn', disabled: t.locked, onclick: () => logFor(t) }, Icon('clock'), 'Log session'));
      }
      if (data.canApprove && t.state === 'pending') actions.push(h('button', { class: 'btn mint', onclick: (e) => approve(t, e.currentTarget) }, Icon('check'), 'Approve'), h('button', { class: 'btn danger', onclick: () => sendBack(t) }, Icon('undo'), 'Send back'));
      if (data.canStructure) actions.push(h('button', { class: 'btn', onclick: () => Views.topicModal({ data, topic: t, onSaved: (r) => { data = r; render(); } }) }, Icon('edit'), 'Edit'), h('button', { class: 'btn danger', onclick: () => removeTopic(t) }, Icon('trash')));
      return h('div', { class: `c-${data.goal.color}` },
        UI.pill(t.state),
        h('h2', null, t.title),
        t.description ? h('p', { class: 'sub', style: { color: 'var(--muted)' } }, t.description) : null,
        t.locked ? banner('lock', 'rose', 'Locked — finish ', h('b', null, t.missing.map((m) => m.title).join(', ')), ' first.') : null,
        t.state === 'pending' ? banner('hourglass', 'amber', data.canApprove ? 'Submitted for your approval. Dependants stay locked until you approve it.' : `Waiting for ${data.goal.assignedByName || 'your mentor'} to approve. Dependants unlock once it is approved.`) : null,
        t.review && t.review.status === 'changes' && !t.complete ? banner('chat', 'rose', h('b', null, `${t.review.byName || 'Mentor'} asked for changes: `), t.review.comment) : null,
        t.review && t.review.status === 'approved' && t.complete ? banner('check', 'mint', `Approved by ${t.review.byName || 'your mentor'}.`) : null,
        h('div', { class: 'grid g-2', style: { marginTop: '16px' } }, h('div', { class: 'stat' }, h('b', null, UI.fmtMin(t.minutes)), h('span', null, est ? `of ${UI.fmtMin(est)} estimated` : 'Studied')), h('div', { class: 'stat' }, h('b', null, t.complete && t.completedOn ? UI.fmtDate(t.completedOn) : '—'), h('span', null, 'Completed'))),
        est ? h('div', { class: 'progress', style: { marginTop: '10px' }, title: `${pctEst}% of the estimate` }, h('i', { style: { '--w': pctEst + '%' } })) : null,
        h('h4', null, `Prerequisites (${prereqs.length})`),
        prereqs.length ? h('div', { class: 'list' }, prereqs.map((p) => h('div', { class: 'li click', onclick: () => openDrawer(p) }, UI.stateIcon(p.state), h('div', { class: 'grow' }, h('b', null, p.title)), UI.pill(p.state)))) : h('p', { class: 'hint' }, 'None — this topic is always open.'),
        h('h4', null, `Unlocks (${t.dependents.length})`),
        t.dependents.length ? h('div', { class: 'list' }, t.dependents.map((d) => { const dt = topicById(d.id); return h('div', { class: 'li click', onclick: () => openDrawer(dt) }, UI.stateIcon(dt.state), h('div', { class: 'grow' }, h('b', null, d.title)), UI.pill(dt.state)); })) : h('p', { class: 'hint' }, 'Nothing depends on this yet.'),
        t.notes !== undefined && (t.notes || (t.resources || []).length || data.canEdit) ? [
          h('h4', null, 'Notes & links'),
          t.notes ? h('p', { class: 'notes-text' }, t.notes) : h('p', { class: 'hint' }, data.canEdit ? 'No notes yet.' : 'No notes.'),
          (t.resources || []).length ? h('div', { class: 'res-list' }, t.resources.map((r) => h('a', { class: 'res', href: r.url, target: '_blank', rel: 'noopener noreferrer nofollow' }, Icon('link'), h('span', null, r.title), h('small', null, (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return ''; } })())))) : null,
          data.canEdit ? h('button', { class: 'btn sm', style: { marginTop: '10px' }, onclick: () => UI.modal((close) => h('div', null, h('h2', null, `Notes · ${t.title}`), Views.notesEditor({ topic: t, canEdit: true, onSaved: (r) => { data = r; close(); render(); } }), h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: close }, 'Cancel')))) }, Icon('edit'), t.notes || (t.resources || []).length ? 'Edit notes & links' : 'Add notes & links') : null,
        ] : null,
        h('h4', null, 'Check your understanding'),
        h('button', { class: 'btn sm', onclick: () => Views.quizModal({ topic: t, canRecord: data.canEdit }) }, Icon('sparkles'), 'Quiz me on this topic'),
        h('h4', null, 'Recent sessions'),
        sess.length ? h('div', { class: 'list' }, sess.map((s) => h('div', { class: 'li' }, h('div', { class: 'grow' }, h('b', null, UI.fmtMin(s.minutes)), h('small', null, s.note || '—')), h('div', { class: 'end' }, UI.fmtDate(s.date), s.time ? h('small', null, s.time) : null)))) : h('p', { class: 'hint' }, 'No sessions yet.'),
        actions.length ? h('div', { class: 'actions', style: { marginTop: '26px' } }, actions) : null
      );
    }

    /* ---------- render ---------- */
    function renderBody() {
      const body = root.querySelector('#goal-body');
      if (!body) return;
      body.replaceChildren(tab === 'map' ? mapTab() : tab === 'topics' ? topicsTab() : tab === 'sessions' ? sessionsTab() : activityTab());
      root.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    }
    const mapCard = () => h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Prerequisite map'), h('p', { class: 'sub' }, 'Select a topic to see what it needs and what it unlocks'))), Charts.topicGraph({ topics: data.topics, selectedId, fresh, done, onSelect: openDrawer }));
    // Progress charts shown under the map, so percent complete, total minutes and a chart are all visible on the goal's first view.
    const weeklyCard = () => h('section', { class: `card c-${data.goal.color}` }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Study time per week'), h('p', { class: 'sub' }, `${UI.fmtMin(data.progress.totalMinutes)} logged in total`))), Charts.area({ data: data.weekly.map((w, i) => ({ label: i === data.weekly.length - 1 ? 'Now' : UI.fmtDate(w.start), value: w.minutes, tip: `${UI.fmtDate(w.start)} – ${UI.fmtDate(w.end)}` })), valueFmt: UI.fmtMin }));
    const topicTimeCard = () => {
      const byTopic = data.topics.filter((t) => t.minutes).sort((a, b) => b.minutes - a.minutes).map((t) => ({ label: t.title, value: t.minutes, color: `var(--${data.goal.color})` }));
      return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Time per topic'), h('p', { class: 'sub' }, `${data.progress.completeTopics} of ${data.progress.totalTopics} topics complete`))), byTopic.length ? Charts.hBars({ items: byTopic, valueFmt: UI.fmtMin }) : h('div', { class: 'empty' }, 'Log a session to see time per topic.'));
    };
    const mapTab = () => h('div', { class: 'grid' }, Views.forecastCard(data.forecast, data.goal), mapCard(), h('div', { class: 'grid g-2' }, weeklyCard(), topicTimeCard()));
    const topicsTab = () => data.topics.length
      ? h('div', { class: 'list' }, data.topics.map((t, i) => h('div', { class: `card li click topic-row reveal`, style: { '--i': i, padding: '14px 16px' }, onclick: () => openDrawer(t) }, UI.stateIcon(t.state), h('div', null, h('b', { style: { whiteSpace: 'normal' } }, t.title), t.locked ? h('small', { class: 'missing' }, `Needs ${t.missing.map((m) => m.title).join(', ')}`) : h('small', null, t.prerequisites.length ? `After ${t.prerequisites.map((p) => topicById(p).title).join(', ')}` : 'No prerequisites')), h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, h('span', { class: 'end' }, UI.fmtMin(t.minutes), t.estimateMinutes ? h('small', null, `of ${UI.fmtMin(t.estimateMinutes)}`) : null), UI.pill(t.state)))))
      : h('div', { class: 'card empty' }, Icon('graph'), h('p', null, 'No topics yet.'), data.canStructure ? h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: () => Views.topicModal({ data, onSaved: (r) => { data = r; render(); } }) }, Icon('plus'), 'Add the first topic')) : null);
    const sessionsTab = () => {
      const byTopic = data.topics.filter((t) => t.minutes).sort((a, b) => b.minutes - a.minutes).map((t) => ({ label: t.title, value: t.minutes, color: `var(--${data.goal.color})` }));
      return h('div', { class: 'grid g-main' },
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Session log')), data.sessions.length
          ? h('div', { class: 'list' }, data.sessions.map((s) => h('div', { class: 'li' }, h('span', { class: 'dot', style: { '--c': `var(--${data.goal.color})` } }), h('div', { class: 'grow' }, h('b', null, s.topicTitle), h('small', null, s.note || '—')), h('div', { class: 'end' }, UI.fmtMin(s.minutes), h('small', null, UI.fmtDate(s.date))), data.canEdit ? h('button', { class: 'icon-btn', 'aria-label': 'Delete session', onclick: async () => { try { await API.deleteSession(s.id); data = await API.goal(id); UI.toast('Session removed', 'info'); render(); } catch (e) { UI.toast(e.message, 'err'); } } }, Icon('trash')) : null)))
          : h('div', { class: 'empty' }, Icon('clock'), h('p', null, 'No sessions logged for this goal yet.'))),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Time per topic')), byTopic.length ? Charts.hBars({ items: byTopic, valueFmt: UI.fmtMin }) : h('div', { class: 'empty' }, 'Nothing to chart yet.')));
    };
    const activityTab = () => h('div', { class: 'grid g-2' },
      h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Weekly study time'), h('p', { class: 'sub' }, 'This goal only'))), Charts.area({ data: data.weekly.map((w, i) => ({ label: i === data.weekly.length - 1 ? 'Now' : UI.fmtDate(w.start), value: w.minutes, tip: `${UI.fmtDate(w.start)} – ${UI.fmtDate(w.end)}` })), valueFmt: UI.fmtMin })),
      h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Mentor feedback')),
        data.feedback.length ? h('div', { class: 'list' }, data.feedback.map((f) => h('div', { class: 'fb' }, h('b', null, f.authorName), h('p', null, f.text)))) : h('div', { class: 'empty' }, Icon('chat'), h('p', null, 'No feedback yet.')),
        feedbackBox()));
    function feedbackBox() {
      if (App.user.role !== 'mentor') return null;
      const ta = h('textarea', { class: 'textarea', placeholder: `Leave feedback for ${data.owner.name}…`, maxlength: 600 });
      const send = h('button', { class: 'btn primary', type: 'submit' }, Icon('chat'), 'Send feedback');
      const f = h('form', { style: { marginTop: '14px' }, novalidate: true }, UI.field('', ta, 'text'), send);
      f.addEventListener('submit', (e) => { e.preventDefault(); UI.clearErrors(f); UI.withBusy(send, async () => { try { data = await API.addFeedback(data.goal.id, ta.value); UI.toast('Feedback sent'); tab = 'activity'; render(); } catch (err) { UI.applyApiError(f, err); } }); });
      return f;
    }

    function render() {
      const g = data.goal, p = data.progress;
      root.replaceChildren(
        h('a', { class: 'back', href: App.user.role === 'mentor' ? `#/learners/${g.ownerId}` : '#/' }, Icon('back'), App.user.role === 'mentor' ? `Back to ${data.owner.name}` : 'Back to dashboard'),
        h('section', { class: `card goal-hero c-${g.color}` },
          Charts.ring({ percent: p.percent, size: 112, stroke: 10, fs: 24, color: g.color }),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('h1', null, g.title),
            g.description ? h('p', null, g.description) : h('p'),
            h('div', { class: 'meta' }, h('span', null, Icon('check'), `${p.completeTopics}/${p.totalTopics} topics`), h('span', null, Icon('clock'), UI.fmtMin(p.totalMinutes)), g.targetDate ? h('span', null, Icon('flag'), `Target ${UI.fmtDate(g.targetDate)}`) : null, UI.forecastChip(data.forecast), g.assigned ? h('span', { class: 'tag' }, Icon('send'), `Assigned by ${g.assignedByName || 'mentor'}`) : null, g.requireApproval ? h('span', { class: 'tag' }, Icon('shield'), 'Needs approval') : null, !data.canEdit ? h('span', null, Icon('eye'), 'View only') : null)),
          h('div', { class: 'actions' },
            data.canEdit ? h('button', { class: 'btn primary', onclick: () => logFor(null) }, Icon('bolt'), 'Log session') : null,
            data.canStructure ? h('button', { class: 'btn', onclick: () => Views.topicModal({ data, onSaved: (r) => { data = r; render(); } }) }, Icon('plus'), 'Add topic') : null,
            data.canEdit ? h('button', { class: 'btn', onclick: () => Views.shareModal({ data, onChange: (r) => { data = r; } }) }, Icon('share'), data.shares && data.shares.length ? `Share (${data.shares.length})` : 'Share') : null,
            Views.exportMenu({ goalId: g.id, learnerId: App.user.role === 'mentor' ? g.ownerId : undefined }),
            data.canStructure ? h('button', { class: 'icon-btn', 'aria-label': 'Edit goal', onclick: () => Views.goalModal({ goal: g, onSaved: (r) => { data = r; render(); } }) }, Icon('edit')) : null,
            data.canStructure ? h('button', { class: 'icon-btn', 'aria-label': 'Delete goal', onclick: removeGoal }, Icon('trash')) : null)),
        h('div', { style: { margin: '0 0 18px' } }, h('div', { class: 'tabs', role: 'tablist' }, [['map', 'Prerequisite map', 'graph'], ['topics', 'Topics', 'list'], ['sessions', 'Sessions', 'clock'], ['activity', 'Activity & feedback', 'chat']].map(([k, label]) => h('button', { 'data-tab': k, role: 'tab', class: tab === k ? 'on' : '', onclick: () => { tab = k; renderBody(); } }, label)))),
        h('div', { id: 'goal-body', class: 'page-enter' })
      );
      renderBody();
      const sel = selectedId && topicById(selectedId);
      if (sel) { if (UI.drawer.isOpen()) UI.drawer.replace(drawerBody(sel)); else openDrawer(sel); }
    }

    render();
    root.__cleanup = () => UI.drawer.close();
    return root;
  };
})();
