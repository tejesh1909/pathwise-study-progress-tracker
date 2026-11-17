/* Reusable pieces for the goal page: forecast card, notes & links, quiz, share link, export menu. */
window.Views = window.Views || {};
(function () {
  'use strict';
  const fm = (m) => UI.fmtMin(m);

  Views.forecastCard = function (f, goal) {
    if (!f || f.status === 'empty') return null;
    const stat = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));
    return h('section', { class: `card fc-card fcs-${f.status} c-${UI.FC_COLOR[f.status] || 'sky'}` },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Deadline forecast'), h('p', { class: 'sub' }, 'Estimates + your last four weeks of study')), UI.forecastChip(f) || h('span', { class: 'chip' }, UI.FC_LABEL[f.status])),
      h('p', { class: 'fc-head' }, f.headline),
      f.status !== 'done' ? h('div', { class: 'grid g-4 fc-stats' },
        stat(fm(f.remainingMinutes), 'Left to study'),
        stat(f.paceMinutesPerWeek ? fm(f.paceMinutesPerWeek) + '/wk' : '—', 'Your pace'),
        stat(goal.targetDate ? (f.requiredMinutesPerWeek ? fm(f.requiredMinutesPerWeek) + '/wk' : '—') : '—', 'Needed to hit target'),
        stat(f.projectedDate ? UI.fmtDate(f.projectedDate) : '—', 'Projected finish')) : null,
      f.assumedTopics ? h('p', { class: 'hint' }, `${f.assumedTopics} topic${f.assumedTopics === 1 ? ' has' : 's have'} no estimate yet, so an average was assumed. Add estimates for a sharper forecast.`) : null);
  };

  /* ----- notes & links ----- */
  Views.notesEditor = function ({ topic, canEdit, onSaved }) {
    const notes = h('textarea', { class: 'textarea', maxlength: 2000, rows: 5, placeholder: 'Key ideas, gotchas, exercises you want to redo…', disabled: !canEdit }, topic.notes || '');
    const links = (topic.resources || []).map((r) => ({ ...r }));
    const list = h('div', { class: 'res-edit' });
    const paint = () => list.replaceChildren(...links.map((r, i) => h('div', { class: 'res-row' },
      h('input', { class: 'input', placeholder: 'Title (optional)', value: r.title || '', disabled: !canEdit, oninput: (e) => (r.title = e.target.value) }),
      h('input', { class: 'input', placeholder: 'https://…', value: r.url || '', disabled: !canEdit, oninput: (e) => (r.url = e.target.value) }),
      canEdit ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove link', onclick: () => { links.splice(i, 1); paint(); } }, Icon('x')) : null)));
    paint();
    const save = h('button', { class: 'btn primary', type: 'submit' }, Icon('check'), 'Save notes & links');
    const form = h('form', { novalidate: true },
      UI.field('Notes', notes, 'notes'),
      h('div', { class: 'field', 'data-name': 'resources' }, h('label', null, 'Resource links'), list, canEdit && links.length < 10 ? h('button', { class: 'btn sm', type: 'button', onclick: () => { links.push({ title: '', url: '' }); paint(); } }, Icon('plus'), 'Add link') : null, h('div', { class: 'err' })),
      canEdit ? save : null);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      UI.clearErrors(form);
      UI.withBusy(save, async () => {
        try { const r = await API.saveNotes(topic.id, { notes: notes.value, resources: links.filter((l) => l.url.trim()) }); UI.toast('Notes saved'); onSaved && onSaved(r); }
        catch (err) { UI.applyApiError(form, err); }
      });
    });
    return form;
  };

  /* ----- quiz ----- */
  Views.quizModal = function ({ topic, canRecord }) {
    UI.modal((close) => {
      const body = h('div', null, UI.skeleton(2, 80));
      (async () => {
        let r;
        try { r = await API.quiz(topic.id); } catch (err) { body.replaceChildren(h('p', { class: 'hint' }, err.message)); return; }
        const q = r.quiz, src = h('span', { class: 'src' }, Icon('sparkles'), r.source === 'gemini' ? 'Written by Gemini' : 'Built-in self-check');
        if (q.kind === 'prompts') {
          body.replaceChildren(src,
            h('p', { class: 'sub' }, 'Answer these out loud or on paper, then check your notes. No marks — just honest recall.'),
            h('ol', { class: 'qz-prompts' }, q.questions.map((x) => h('li', null, x.prompt))),
            h('p', { class: 'hint' }, 'Multiple-choice quizzes with answers are written by Gemini when an API key is configured.'));
          return;
        }
        let i = 0, score = 0;
        const show = () => {
          if (i >= q.questions.length) {
            if (canRecord) API.quizAttempt(topic.id, score, q.questions.length).catch(() => {});
            return body.replaceChildren(src, h('div', { class: 'qz-score' }, h('b', null, `${score} / ${q.questions.length}`), h('span', null, score === q.questions.length ? 'Perfect — this one is solid.' : score >= q.questions.length / 2 ? 'Good — review the ones you missed.' : 'Worth another pass over your notes.')), h('button', { class: 'btn', onclick: () => { i = 0; score = 0; show(); } }, Icon('undo'), 'Try again'));
          }
          const item = q.questions[i];
          let answered = false;
          const exp = h('p', { class: 'qz-exp' });
          const opts = item.options.map((o, k) => h('button', { class: 'qz-opt', type: 'button', onclick: () => {
            if (answered) return; answered = true;
            const ok = k === item.answerIndex; if (ok) score++;
            opts.forEach((b, j) => b.classList.add(j === item.answerIndex ? 'right' : j === k ? 'wrong' : 'off'));
            exp.textContent = (ok ? 'Correct. ' : 'Not quite. ') + (item.explanation || '');
            next.style.display = '';
          } }, o));
          const next = h('button', { class: 'btn primary', style: { display: 'none' }, onclick: () => { i++; show(); } }, i === q.questions.length - 1 ? 'See score' : 'Next', Icon('arrow'));
          body.replaceChildren(src, h('div', { class: 'hint' }, `Question ${i + 1} of ${q.questions.length}`), h('h3', { class: 'qz-q' }, item.question), h('div', { class: 'qz-opts' }, opts), exp, next);
        };
        show();
      })();
      return h('div', null, h('h2', null, `Quiz: ${topic.title}`), body, h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: close }, 'Close')));
    });
  };

  /* ----- share links ----- */
  Views.shareModal = function ({ data, onChange }) {
    UI.modal((close) => {
      let shares = data.shares;
      const wrap = h('div');
      const days = h('select', { class: 'select' }, [[7, 'Expires in 7 days'], [30, 'Expires in 30 days'], [90, 'Expires in 90 days'], [0, 'Never expires']].map(([v, l]) => h('option', { value: v }, l)));
      days.value = '30';
      const urlFor = (t) => `${location.origin}${location.pathname}#/s/${t}`;
      const paint = () => wrap.replaceChildren(
        h('div', { class: 'share-new' }, days, h('button', { class: 'btn primary', onclick: async (e) => { await UI.withBusy(e.currentTarget, async () => { try { const r = await API.createShare(data.goal.id, Number(days.value)); shares = r.shares; onChange && onChange(r); paint(); UI.toast('Share link created'); } catch (err) { UI.toast(err.message, 'err'); } }); } }, Icon('link'), 'Create link')),
        shares.length ? h('div', { class: 'list', style: { marginTop: '14px' } }, shares.map((s) => h('div', { class: 'li share-li' },
          h('span', { class: 'sico available' }, Icon('link')),
          h('div', { class: 'grow' }, h('input', { class: 'input', readonly: true, value: urlFor(s.token), onfocus: (e) => e.target.select() }), h('small', null, s.expiresAt ? `Expires ${UI.fmtDate(String(s.expiresAt).slice(0, 10))}` : 'Never expires')),
          h('button', { class: 'icon-btn', 'aria-label': 'Copy link', onclick: async () => { try { await navigator.clipboard.writeText(urlFor(s.token)); UI.toast('Link copied'); } catch { UI.toast('Select the link and copy it', 'info'); } } }, Icon('copy')),
          h('button', { class: 'icon-btn', 'aria-label': 'Revoke link', onclick: async () => { try { const r = await API.revokeShare(s.id); shares = r.shares; onChange && onChange(r); paint(); UI.toast('Link revoked — it no longer works', 'info'); } catch (err) { UI.toast(err.message, 'err'); } } }, Icon('trash')))))
          : h('p', { class: 'hint', style: { marginTop: '14px' } }, 'No active links. Create one to share a read-only view of this goal.'));
      paint();
      return h('div', null, h('h2', null, 'Share progress'), h('p', { class: 'sub' }, 'Anyone with the link can see this goal’s topics, progress and forecast — read-only. Your email, notes, resource links, session notes and mentor feedback are never included.'), wrap, h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: close }, 'Done')));
    });
  };

  /* ----- export ----- */
  Views.exportMenu = function ({ goalId, learnerId }) {
    const params = { goalId, learnerId };
    const showCsv = async (kind) => {
      if (API.mock) { // the preview can't download files, so show the CSV instead
        const r = await API.exportDownload(kind, params);
        return UI.modal((close) => h('div', null, h('h2', null, `Export preview · ${kind}.csv`), h('p', { class: 'sub' }, 'Downloads are disabled in this preview; the real app downloads this as a file.'), h('textarea', { class: 'textarea csv', readonly: true, rows: 12 }, r.text), h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: close }, 'Close'))));
      }
      location.href = API.exportUrl(kind === 'sessions' ? 'sessions' : 'csv', params);
    };
    const wrap = h('div', { class: 'menu-wrap' });
    const menu = h('div', { class: 'menu', hidden: true },
      h('button', { onclick: () => { menu.hidden = true; showCsv('topics'); } }, Icon('download'), 'Topics (CSV)'),
      h('button', { onclick: () => { menu.hidden = true; showCsv('sessions'); } }, Icon('download'), 'Sessions (CSV)'),
      h('button', { onclick: () => { menu.hidden = true; if (API.mock) return UI.toast('PDF export is available in the full app (not in this preview)', 'info'); location.href = API.exportUrl('pdf', params); } }, Icon('download'), 'Report (PDF)'));
    const btn = h('button', { class: 'btn', type: 'button', 'aria-haspopup': 'true', onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } }, Icon('download'), 'Export');
    wrap.append(btn, menu);
    document.addEventListener('click', () => { menu.hidden = true; });
    return wrap;
  };
})();
