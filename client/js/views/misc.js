window.Views = window.Views || {};
(function () {
  'use strict';

  /* ---------- log a session (page) ---------- */
  Views.log = async function () {
    const [goals, list] = await Promise.all([API.goals(), API.sessions({ limit: 12 })]);
    const payloads = await Promise.all(goals.goals.map((g) => API.goal(g.id)));
    if (!payloads.length) return h('div', { class: 'card empty' }, Icon('book'), h('p', null, 'Create a goal and add topics before logging study time.'), h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onclick: () => App.go('/') }, 'Go to dashboard')));
    const { config, today } = payloads[0];
    const recent = h('div', { class: 'list' });
    const paintRecent = (rows) => recent.replaceChildren(...(rows.length ? rows.map((s) => h('div', { class: `li c-${s.goalColor}` }, h('span', { class: 'dot' }), h('div', { class: 'grow' }, h('b', null, s.topicTitle), h('small', null, s.note || s.goalTitle)), h('div', { class: 'end' }, UI.fmtMin(s.minutes), h('small', null, UI.relDay(s.date, today))))) : [h('div', { class: 'empty' }, 'Nothing logged yet.')]));
    paintRecent(list.sessions);

    // optional focus timer → fills the minutes field
    let started = 0, tick = null;
    const display = h('div', { class: 't' }, '00:00');
    const timerBtn = h('button', { class: 'btn go', type: 'button' }, Icon('play'), 'Start timer');
    const timer = h('div', { class: 'timer' }, display, timerBtn, h('span', { class: 'hint' }, 'Optional: time yourself, then log it.'));
    const form = Views.sessionForm({
      groups: Views.groupsFrom(payloads), config, today,
      onSaved: async () => { paintRecent((await API.sessions({ limit: 12 })).sessions); },
    });
    timerBtn.addEventListener('click', () => {
      if (!started) {
        started = Date.now();
        timer.classList.add('run');
        timerBtn.replaceChildren(Icon('stop'), 'Stop & use time');
        tick = setInterval(() => { const s = Math.floor((Date.now() - started) / 1000); display.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }, 500);
      } else {
        clearInterval(tick);
        const m = Math.max(1, Math.round((Date.now() - started) / 60000));
        form.setMinutes(Math.min(config.maxSessionMinutes, Math.max(config.minSessionMinutes, m)));
        started = 0;
        timer.classList.remove('run');
        timerBtn.replaceChildren(Icon('play'), 'Start timer');
        display.textContent = '00:00';
        UI.toast(`Timer added ${m} min to the form`, 'info');
      }
    });
    const root = h('div', null,
      h('div', { class: 'topbar' }, h('div', null, h('h1', null, 'Log a session'), h('p', { class: 'sub' }, 'Minutes between ', h('b', null, config.minSessionMinutes), ' and ', h('b', null, config.maxSessionMinutes), ' · no future dates · locked topics are disabled'))),
      h('div', { class: 'grid g-main' },
        h('section', { class: 'card tilt reveal' }, timer, form.el),
        h('section', { class: 'card reveal', style: { '--i': 2 } }, h('div', { class: 'card-head' }, h('h3', null, 'Recent sessions')), recent)));
    root.__cleanup = () => clearInterval(tick);
    return root;
  };

  /* ---------- weekly review + plan ---------- */
  Views.insights = async function ({ learnerId }) {
    const d = await API.insights(learnerId);
    const r = d.review;
    const view = !!learnerId;
    const text = h('p', { class: 'review-text' });
    const full = d.narrative.text;
    // typewriter reveal
    if (UI.reduced()) text.textContent = full; else {
      const caret = h('span', { class: 'caret' });
      let i = 0;
      const step = () => { if (!text.isConnected && i) return; text.textContent = full.slice(0, i); text.append(caret); i += 2; if (i <= full.length + 1) setTimeout(step, 16); else { text.textContent = full; } };
      step();
    }
    const delta = r.deltaPercent;
    const total = d.plan.items.reduce((a, i) => a + i.minutes, 0) || 1;
    const colors = ['violet', 'cyan', 'mint', 'amber', 'rose', 'sky'];
    const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const sch = d.schedule;
    const scheduleCard = sch && sch.slots.length ? h('section', { class: 'card tilt c-mint reveal', style: { '--i': 6 } },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Your week, scheduled'), h('p', { class: 'sub' }, sch.basis === 'habits'
        ? `Based on when you actually study: ${sch.habits.preferredWeekdays.map((x) => DN[x]).join(', ')}, usually around ${sch.habits.startWeekday || sch.habits.startWeekend} for ~${UI.fmtMin(sch.habits.typicalMinutes)}.`
        : 'Not enough history yet to learn your habits — using sensible defaults. Log a few timed sessions to personalise this.'))),
      h('div', { class: 'list sched' }, sch.slots.map((x, i) => h('div', { class: `li c-${colors[i % colors.length]}`, style: { '--i': i } },
        h('div', { class: 'when' }, h('b', null, x.weekday.slice(0, 3)), h('small', null, UI.fmtDate(x.date))),
        h('div', { class: 'grow' }, h('b', { style: { whiteSpace: 'normal' } }, x.title), h('small', { style: { whiteSpace: 'normal' } }, x.reason)),
        h('div', { class: 'end' }, x.time, h('small', null, UI.fmtMin(x.minutes))))))) : null;
    return h('div', null,
      h('div', { class: 'topbar' }, h('div', null, h('h1', null, 'Weekly review'), h('p', { class: 'sub' }, `${UI.fmtDate(r.period.from)} – ${UI.fmtDate(r.period.to)}${view ? ` · ${d.learner.name}` : ''}`))),
      h('div', { class: 'grid g-main' },
        h('div', { class: 'grid' },
          h('section', { class: 'card tilt c-violet reveal' },
            h('div', { class: 'card-head' }, h('h3', null, 'How the week went'), h('span', { class: 'src' }, Icon('sparkles'), d.narrative.source === 'gemini' ? 'Written by Gemini' : 'Auto summary')),
            text),
          h('div', { class: 'grid g-4 kpis' },
            [['Studied', UI.fmtMin(r.minutes), delta == null ? 'first week' : `${delta >= 0 ? '+' : ''}${delta}% vs last`], ['Sessions', r.sessions, `${r.activeDays} active days`], ['Target', r.targetPercent + '%', UI.fmtMin(r.targetMinutes)], ['Streak', r.streak + ' d', r.streak ? 'keep going' : 'start today']].map(([label, value, sub], i) => h('div', { class: 'stat reveal', style: { '--i': i + 1 } }, h('b', null, value), h('span', null, label), h('div', { class: 'hint' }, sub)))),
          h('section', { class: 'card reveal', style: { '--i': 5 } }, h('div', { class: 'card-head' }, h('h3', null, 'Highlights')),
            h('div', { class: 'list' },
              r.completed.length ? h('div', { class: 'li c-mint' }, UI.stateIcon('complete'), h('div', { class: 'grow' }, h('b', null, 'Completed this week'), h('small', null, r.completed.join(', ')))) : null,
              r.topTopics.length ? h('div', { class: 'li c-violet' }, h('span', { class: 'sico available' }, Icon('bolt')), h('div', { class: 'grow' }, h('b', null, 'Most time'), h('small', null, r.topTopics.map((t) => `${t.title} (${UI.fmtMin(t.minutes)})`).join(' · ')))) : null,
              r.stalled.length ? h('div', { class: 'li c-amber' }, UI.stateIcon('in_progress'), h('div', { class: 'grow' }, h('b', null, 'Gone quiet'), h('small', null, r.stalled.map((s) => `${s.title} (${s.daysSince}d)`).join(' · ')))) : null,
              r.readyToStart.length ? h('div', { class: 'li c-cyan' }, UI.stateIcon('available'), h('div', { class: 'grow' }, h('b', null, 'Unlocked & untouched'), h('small', null, r.readyToStart.join(', ')))) : null,
              !r.completed.length && !r.topTopics.length && !r.stalled.length && !r.readyToStart.length ? h('div', { class: 'empty' }, 'Nothing to highlight yet.') : null))),
        h('section', { class: 'card tilt c-cyan reveal', style: { '--i': 2 } },
          h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Suggested plan'), h('p', { class: 'sub' }, `Next 7 days · ${UI.fmtMin(d.plan.targetMinutes)} total · unlocked topics only`))),
          d.plan.items.length ? [h('div', { class: 'plan-bar' }, d.plan.items.map((it, i) => h('i', { class: `c-${colors[i % colors.length]}`, style: { flex: it.minutes / total, '--i': i } }))),
            h('div', { class: 'list' }, d.plan.items.map((it, i) => h('div', { class: `plan-item c-${colors[i % colors.length]}` }, h('div', { class: 'num' }, i + 1), h('div', null, h('b', null, it.title), h('p', null, it.reason)), h('div', { class: 'mins' }, UI.fmtMin(it.minutes), h('small', null, 'this week')))))]
            : h('div', { class: 'empty' }, Icon('lock'), h('p', null, 'No unlocked topics to plan — finish a prerequisite first.')))),
      scheduleCard ? h('div', { style: { marginTop: '18px' } }, scheduleCard) : null);
  };

  /* ---------- mentor: learners ---------- */
  Views.learners = async function () {
    const { learners, today } = await API.learners();
    return h('div', null,
      h('div', { class: 'topbar' }, h('div', null, h('h1', null, 'Learners'), h('p', { class: 'sub' }, `${learners.length} learner${learners.length === 1 ? '' : 's'} · you can view every goal, leave feedback, assign goals and approve topics`))),
      h('div', { class: 'actions', style: { margin: '-4px 0 16px' } }, h('a', { class: 'btn primary', href: '#/assign' }, Icon('send'), 'Assign a goal'), h('a', { class: 'btn', href: '#/people?tab=cohorts' }, Icon('users'), 'Cohorts'), h('a', { class: 'btn', href: '#/people' }, Icon('userplus'), 'Add people')),
      learners.length ? h('div', { class: 'list' }, learners.map((l, i) => h('article', { class: 'card tilt li click learner-row reveal', style: { '--i': i, padding: '18px 20px' }, tabindex: 0, onclick: () => App.go(`/learners/${l.id}`), onkeydown: (e) => e.key === 'Enter' && App.go(`/learners/${l.id}`) },
        h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, h('div', { class: 'avatar' }, UI.initials(l.name)), h('div', null, h('b', { style: { fontSize: '15px' } }, l.name), h('small', null, l.cohorts && l.cohorts.length ? l.cohorts.map((c) => c.name).join(' · ') : l.email), l.atRisk || l.pendingApprovals ? h('div', { class: 'row-tags' }, l.atRisk ? h('span', { class: 'fc c-rose' }, Icon('alert'), `${l.atRisk} goal${l.atRisk === 1 ? '' : 's'} at risk`) : null, l.pendingApprovals ? h('span', { class: 'tag' }, Icon('hourglass'), `${l.pendingApprovals} to approve`) : null) : null)),
        h('div', null, h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', color: 'var(--muted)', marginBottom: '6px' } }, h('span', null, `${l.topicsComplete}/${l.topics} topics`), h('b', null, l.percent + '%')), h('div', { class: 'progress' }, h('i', { style: { '--w': l.percent + '%' }, ref: 0 }))),
        h('div', { class: 'stat' }, h('b', null, l.goals), h('span', null, 'goals')),
        h('div', { class: 'stat' }, h('b', null, UI.fmtMin(l.weekMinutes)), h('span', null, 'this week')),
        h('div', { class: 'stat' }, h('b', null, l.streak + 'd'), h('span', null, 'streak')),
        Icon('arrow')))) : h('div', { class: 'card empty' }, Icon('users'), h('p', null, 'No learners have signed up yet.')));
  };

  /* ---------- change password ---------- */
  function passwordCard() {
    const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const nw = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const save = h('button', { class: 'btn', type: 'submit' }, Icon('key'), 'Change password');
    const f = h('form', { novalidate: true }, UI.field('Current password', cur, 'currentPassword'), UI.field('New password', nw, 'newPassword', 'At least 8 characters'), save);
    f.addEventListener('submit', (e) => { e.preventDefault(); UI.clearErrors(f); UI.withBusy(save, async () => { try { await API.changePassword(cur.value, nw.value); cur.value = ''; nw.value = ''; UI.toast('Password changed'); } catch (err) { UI.applyApiError(f, err); } }); });
    return h('section', { class: 'card reveal', style: { '--i': 1 } }, h('h3', { style: { marginBottom: '14px' } }, 'Your account'), f);
  }

  /* ---------- admin settings ---------- */
  Views.settings = async function () {
    const { config } = await API.config();
    const isMentor = App.user.role === 'mentor';
    const inputs = {
      minSessionMinutes: h('input', { class: 'input', type: 'number', min: 1, max: 1440, value: config.minSessionMinutes }),
      maxSessionMinutes: h('input', { class: 'input', type: 'number', min: 1, max: 1440, value: config.maxSessionMinutes }),
      maxPrerequisitesPerTopic: h('input', { class: 'input', type: 'number', min: 0, max: 25, value: config.maxPrerequisitesPerTopic }),
      weeklyTargetMinutes: h('input', { class: 'input', type: 'number', min: 30, max: 10080, value: config.weeklyTargetMinutes }),
      defaultTopicMinutes: h('input', { class: 'input', type: 'number', min: 15, max: 6000, value: config.defaultTopicMinutes }),
      reopenPolicy: h('select', { class: 'select' }, h('option', { value: 'cascade' }, 'Cascade — reopen dependents too'), h('option', { value: 'block' }, 'Block — refuse while dependents are complete')),
    };
    inputs.reopenPolicy.value = config.reopenPolicy;
    Object.values(inputs).forEach((i) => (i.disabled = !isMentor));
    const save = h('button', { class: 'btn primary', type: 'submit' }, Icon('check'), 'Save settings');
    const preview = h('div', { class: 'cfg-preview' });
    const paint = () => preview.replaceChildren(
      h('span', { class: 'chip' }, Icon('clock'), `Sessions ${inputs.minSessionMinutes.value}–${inputs.maxSessionMinutes.value} min`),
      h('span', { class: 'chip' }, Icon('graph'), `≤ ${inputs.maxPrerequisitesPerTopic.value} prerequisites`),
      h('span', { class: 'chip' }, Icon('target'), `${inputs.weeklyTargetMinutes.value} min / week`),
      h('span', { class: 'chip' }, Icon('trending'), `${inputs.defaultTopicMinutes.value} min default estimate`),
      h('span', { class: 'chip' }, Icon('undo'), inputs.reopenPolicy.value === 'cascade' ? 'Reopen cascades' : 'Reopen blocked'));
    Object.values(inputs).forEach((i) => i.addEventListener('input', paint));
    paint();
    const form = h('form', { novalidate: true },
      h('div', { class: 'row' },
        UI.field('Minimum session (minutes)', inputs.minSessionMinutes, 'minSessionMinutes', 'Shortest session a learner may log'),
        UI.field('Maximum session (minutes)', inputs.maxSessionMinutes, 'maxSessionMinutes', 'Longest session a learner may log')),
      h('div', { class: 'row' },
        UI.field('Max prerequisites per topic', inputs.maxPrerequisitesPerTopic, 'maxPrerequisitesPerTopic', 'Applies when topics are created or edited'),
        UI.field('Weekly target (minutes)', inputs.weeklyTargetMinutes, 'weeklyTargetMinutes', 'Used by the dashboard and weekly plan')),
      UI.field('Default topic estimate (minutes)', inputs.defaultTopicMinutes, 'defaultTopicMinutes', 'Assumed by the deadline forecast for topics with no estimate'),
      UI.field('When a completed topic is reopened', inputs.reopenPolicy, 'reopenPolicy', 'Either way, dependents are locked again immediately'),
      isMentor ? save : h('div', { class: 'banner' }, Icon('lock'), h('span', null, 'Only a mentor/admin can change these values.')));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      UI.clearErrors(form);
      UI.withBusy(save, async () => {
        try {
          const body = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, k === 'reopenPolicy' ? el.value : el.value === '' ? '' : Number(el.value)]));
          await API.saveConfig(body);
          UI.toast('Settings saved — rules updated immediately');
        } catch (err) { UI.applyApiError(form, err); }
      });
    });
    return h('div', null,
      h('div', { class: 'topbar' }, h('div', null, h('h1', null, 'Settings'), h('p', { class: 'sub' }, 'Business rules are configuration, not code. Changes apply immediately for everyone.'))),
      h('div', { class: 'grid g-main' },
        h('div', { class: 'grid' },
        h('section', { class: 'card tilt reveal' }, h('h3', { style: { marginBottom: '14px' } }, 'Rule configuration'), preview, form),
        passwordCard()),
        h('section', { class: 'card reveal', style: { '--i': 2 } }, h('h3', null, 'How the rules work'),
          h('div', { class: 'list', style: { marginTop: '14px' } },
            [['lock', 'Unlock rule', 'A topic stays locked until every prerequisite is complete.'], ['undo', 'Re-locking', 'Reopening a topic locks everything that depends on it again.'], ['graph', 'No loops', 'A topic can’t require itself, directly or through a chain.'], ['clock', 'Session limits', 'Minutes outside the range, or dates in the future, are rejected.']].map(([ic, t, s]) => h('div', { class: 'li' }, h('span', { class: 'sico available' }, Icon(ic)), h('div', { class: 'grow' }, h('b', { style: { whiteSpace: 'normal' } }, t), h('small', { style: { whiteSpace: 'normal' } }, s))))))));
  };
})();
