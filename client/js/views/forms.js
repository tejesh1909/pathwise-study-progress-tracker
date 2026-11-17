/* Shared forms: log-session form, goal modal, topic modal. */
window.Views = window.Views || {};
(function () {
  'use strict';
  const COLORS = ['violet', 'cyan', 'mint', 'amber', 'rose', 'sky'];

  /** Builds groups for the topic <select> from goal payloads (API.goal responses). */
  Views.groupsFrom = (goalPayloads) =>
    goalPayloads.map((p) => ({ goalTitle: p.goal.title, color: p.goal.color, topics: p.topics.map((t) => ({ id: t.id, title: t.title, state: t.state, locked: t.locked, missing: t.missing })) }));

  /**
   * The session log form: date, topic, minutes, note.
   * Client-side checks mirror the server (configured min/max minutes, no future dates, no locked topics);
   * the server is still the authority and its field errors are shown inline.
   */
  Views.sessionForm = function ({ groups, config, today, presetTopicId, onSaved }) {
    const min = config.minSessionMinutes, max = config.maxSessionMinutes;
    const select = h('select', { class: 'select', name: 'topic' },
      h('option', { value: '' }, 'Choose a topic…'),
      groups.map((g) => h('optgroup', { label: g.goalTitle }, g.topics.map((t) => h('option', { value: t.id, disabled: t.locked }, t.locked ? `${t.title} (locked — needs ${t.missing.map((m) => m.title).join(', ')})` : t.title))))
    );
    if (presetTopicId) select.value = presetTopicId;
    const date = h('input', { class: 'input', type: 'date', name: 'date', value: today, max: today });
    const time = h('input', { class: 'input', type: 'time', name: 'time' });
    const minutes = h('input', { class: 'input', type: 'number', name: 'minutes', min, max, step: 1, inputmode: 'numeric', value: Math.min(max, Math.max(min, 30)) });
    const note = h('textarea', { class: 'textarea', name: 'note', maxlength: 500, placeholder: 'What did you cover? (optional)' });
    const chips = h('div', { class: 'qchips' }, [15, 25, 45, 60, 90, 120].filter((m) => m >= min && m <= max).map((m) => h('button', { type: 'button', onclick: () => (minutes.value = m) }, UI.fmtMin(m))));
    const submit = h('button', { class: 'btn primary block', type: 'submit' }, Icon('check'), 'Log session');
    const form = h('form', { novalidate: true },
      UI.field('Topic', select, 'topic'),
      h('div', { class: 'row' }, UI.field('Date', date, 'date', "Can't be in the future"), UI.field('Start time', time, 'time', 'Optional — helps plan around your habits')),
      UI.field('Minutes studied', minutes, 'minutes', `Between ${min} and ${max}`),
      chips,
      h('div', { style: { height: '14px' } }),
      UI.field('Note', note, 'note'),
      submit
    );
    const state = {
      setMinutes: (m) => (minutes.value = m),
      setTopic: (id) => (select.value = id),
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      UI.clearErrors(form);
      const errs = {};
      if (!select.value) errs.topic = 'Choose a topic';
      if (!date.value) errs.date = 'Pick a date';
      else if (date.value > today) errs.date = "Date can't be in the future";
      const m = Number(minutes.value);
      if (minutes.value === '' || !Number.isInteger(m)) errs.minutes = 'Enter whole minutes';
      else if (m < min || m > max) errs.minutes = `Minutes must be between ${min} and ${max}`;
      if (Object.keys(errs).length) {
        Object.entries(errs).forEach(([k, v]) => UI.setFieldError(form, k, v));
        return;
      }
      await UI.withBusy(submit, async () => {
        try {
          const r = await API.logSession({ topicId: select.value, date: date.value, minutes: m, note: note.value, time: time.value });
          UI.toast(`Logged ${UI.fmtMin(m)} of study`);
          note.value = '';
          if (onSaved) onSaved(r.session);
        } catch (err) {
          UI.applyApiError(form, err);
        }
      });
    });
    return Object.assign(state, { el: form });
  };

  Views.sessionModal = function ({ groups, config, today, presetTopicId, onSaved }) {
    UI.modal((close) => {
      const f = Views.sessionForm({ groups, config, today, presetTopicId, onSaved: (s) => { close(); onSaved && onSaved(s); } });
      return h('div', null, h('h2', null, 'Log a study session'), h('div', { class: 'sub' }, 'Locked topics can’t be studied until their prerequisites are complete.'), f.el);
    });
  };

  /** Create / edit a goal. */
  Views.goalModal = function ({ goal, onSaved }) {
    UI.modal((close) => {
      let color = (goal && goal.color) || 'violet';
      const title = h('input', { class: 'input', name: 'title', maxlength: 80, placeholder: 'e.g. Learn Rust', value: goal ? goal.title : '' });
      const desc = h('textarea', { class: 'textarea', name: 'description', maxlength: 500, placeholder: 'What does success look like?' }, goal ? goal.description : '');
      const target = h('input', { class: 'input', type: 'date', name: 'targetDate', value: goal ? goal.targetDate : '' });
      const sw = h('div', { class: 'qchips' });
      const paint = () => sw.replaceChildren(...COLORS.map((c) => h('button', { type: 'button', class: `c-${c}`, 'aria-label': c, 'aria-pressed': String(c === color), style: { width: '34px', height: '34px', padding: 0, borderRadius: '11px', background: 'var(--c)', border: c === color ? '2px solid var(--text)' : '2px solid transparent', transform: c === color ? 'scale(1.12)' : '' }, onclick: () => { color = c; paint(); } })));
      paint();
      const save = h('button', { class: 'btn primary', type: 'submit' }, goal ? 'Save changes' : 'Create goal');
      const form = h('form', { novalidate: true },
        UI.field('Goal title', title, 'title'),
        UI.field('Description', desc, 'description'),
        h('div', { class: 'row' }, UI.field('Target date', target, 'targetDate', 'Optional'), h('div', { class: 'field' }, h('label', null, 'Colour'), sw)),
        h('div', { class: 'foot' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), save)
      );
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        UI.clearErrors(form);
        if (!title.value.trim()) return UI.setFieldError(form, 'title', 'Give the goal a title');
        UI.withBusy(save, async () => {
          try {
            const body = { title: title.value, description: desc.value, color, targetDate: target.value };
            const r = goal ? await API.updateGoal(goal.id, body) : await API.createGoal(body);
            close();
            UI.toast(goal ? 'Goal updated' : 'Goal created');
            onSaved && onSaved(r);
          } catch (err) {
            UI.applyApiError(form, err);
          }
        });
      });
      return h('div', null, h('h2', null, goal ? 'Edit goal' : 'New study goal'), h('div', { class: 'sub' }, goal ? 'Update the details of this goal.' : 'A goal groups the topics you want to master.'), form);
    });
  };

  /** Create / edit a topic including its prerequisites. Loops are prevented in the UI and rejected by the server. */
  Views.topicModal = function ({ data, topic, onSaved }) {
    const maxP = data.config.maxPrerequisitesPerTopic;
    const others = data.topics.filter((t) => !topic || t.id !== topic.id);
    // anything that (transitively) depends on this topic would create a loop if chosen
    const blocked = new Set();
    if (topic) {
      const walk = (id) => data.topics.forEach((t) => t.prerequisites.includes(id) && !blocked.has(t.id) && (blocked.add(t.id), walk(t.id)));
      walk(topic.id);
    }
    UI.modal((close) => {
      const chosen = new Set(topic ? topic.prerequisites : []);
      const title = h('input', { class: 'input', name: 'title', maxlength: 80, placeholder: 'e.g. Graph algorithms', value: topic ? topic.title : '' });
      const desc = h('textarea', { class: 'textarea', name: 'description', maxlength: 500, placeholder: 'Optional notes' }, topic ? topic.description : '');
      const hours = h('input', { class: 'input', name: 'estimateMinutes', type: 'number', min: 0, max: 600, step: 0.5, placeholder: 'e.g. 6', value: topic && topic.estimateMinutes ? Math.round((topic.estimateMinutes / 60) * 100) / 100 : '' });
      const count = h('span');
      const list = h('div', { class: 'checklist' });
      const paint = () => {
        count.textContent = `${chosen.size} of ${maxP} selected`;
        count.style.color = chosen.size > maxP ? 'var(--rose)' : '';
        list.replaceChildren(
          ...(others.length
            ? others.map((t) => {
                const cb = h('input', { type: 'checkbox', checked: chosen.has(t.id), disabled: blocked.has(t.id) });
                cb.addEventListener('change', () => { cb.checked ? chosen.add(t.id) : chosen.delete(t.id); paint(); });
                return h('label', { class: `check${chosen.has(t.id) ? ' on' : ''}`, style: blocked.has(t.id) ? { opacity: 0.5, cursor: 'not-allowed' } : null }, cb, h('span', null, t.title), blocked.has(t.id) ? h('small', { class: 'hint', style: { marginLeft: 'auto' } }, 'would create a loop') : null);
              })
            : [h('div', { class: 'hint' }, 'No other topics in this goal yet.')])
        );
      };
      paint();
      const save = h('button', { class: 'btn primary', type: 'submit' }, topic ? 'Save changes' : 'Add topic');
      const form = h('form', { novalidate: true },
        UI.field('Topic title', title, 'title'),
        UI.field('Description', desc, 'description'),
        UI.field('Estimated study time (hours)', hours, 'estimateMinutes', 'Optional — powers the deadline forecast'),
        h('div', { class: 'field', 'data-name': 'prerequisites' }, h('label', null, 'Prerequisites'), list, h('div', { class: 'hint' }, 'This topic stays locked until all of these are complete. ', count), h('div', { class: 'err' })),
        h('div', { class: 'foot' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), save)
      );
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        UI.clearErrors(form);
        if (!title.value.trim()) return UI.setFieldError(form, 'title', 'Give the topic a title');
        UI.withBusy(save, async () => {
          try {
            const body = { title: title.value, description: desc.value, estimateMinutes: hours.value === '' ? 0 : Math.round(Number(hours.value) * 60), prerequisites: [...chosen] };
            const r = topic ? await API.updateTopic(topic.id, body) : await API.createTopic(data.goal.id, body);
            close();
            UI.toast(topic ? 'Topic updated' : 'Topic added');
            onSaved && onSaved(r);
          } catch (err) {
            UI.applyApiError(form, err);
          }
        });
      });
      return h('div', null, h('h2', null, topic ? 'Edit topic' : 'Add a topic'), h('div', { class: 'sub' }, 'Prerequisites must be topics in this goal, and can’t form a loop.'), form);
    });
  };
})();
