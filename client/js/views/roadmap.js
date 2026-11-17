/* Roadmap generator + editor. Learners turn it into their own goal; mentors assign it to learners / cohorts. */
window.Views = window.Views || {};
(function () {
  'use strict';
  const COLORS = ['violet', 'cyan', 'mint', 'amber', 'rose', 'sky'];
  let seq = 0;
  const newKey = () => 'k' + ++seq;

  Views.roadmap = async function ({ mode }) {
    const assign = mode === 'assign';
    const [{ config }, people, cohorts] = await Promise.all([API.config(), assign ? API.adminUsers() : null, assign ? API.cohorts() : null]);
    const maxP = config.maxPrerequisitesPerTopic;
    const state = { title: '', description: '', color: 'violet', targetDate: '', topics: [], source: null, requireApproval: true, learnerIds: new Set(), cohortIds: new Set() };
    const root = h('div');
    const body = h('div');

    /* ---------- step 1: describe what to learn ---------- */
    const subject = h('input', { class: 'input', placeholder: assign ? 'e.g. Intro to Statistics' : 'e.g. Learn Rust', maxlength: 120, 'aria-label': 'Subject' });
    const level = h('select', { class: 'select', 'aria-label': 'Level' }, [['beginner', 'Beginner'], ['intermediate', 'Some experience'], ['advanced', 'Advanced']].map(([v, l]) => h('option', { value: v }, l)));
    const gen = h('button', { class: 'btn primary', type: 'submit' }, Icon('wand'), 'Generate roadmap');
    const startForm = h('form', { class: 'rm-form', novalidate: true }, h('div', { class: 'grow' }, UI.field('', subject, 'subject')), level, gen);
    startForm.addEventListener('submit', (e) => {
      e.preventDefault();
      UI.clearErrors(startForm);
      UI.withBusy(gen, async () => {
        try {
          body.replaceChildren(UI.skeleton(3, 70));
          const r = await API.roadmap(subject.value, level.value);
          state.title = r.roadmap.title || subject.value;
          state.description = r.roadmap.description || '';
          state.source = r.source;
          const keyMap = new Map();
          state.topics = r.roadmap.topics.map((t) => { const k = newKey(); keyMap.set(t.key, k); return { key: k, title: t.title, description: t.description || '', hours: Math.max(0, Math.round(((t.estimateMinutes || 0) / 60) * 10) / 10), prereqs: new Set(t.prerequisites) }; });
          state.topics.forEach((t) => (t.prereqs = new Set([...t.prereqs].map((k) => keyMap.get(k)).filter(Boolean))));
          paint();
        } catch (err) { body.replaceChildren(); UI.applyApiError(startForm, err); }
      });
    });
    const blank = () => { state.title = subject.value.trim(); state.source = 'blank'; state.topics = [{ key: newKey(), title: '', description: '', hours: 4, prereqs: new Set() }]; paint(); };

    /* ---------- step 2: edit ---------- */
    const earlier = (i) => state.topics.slice(0, i);
    const tidy = () => { // prerequisites may only point at earlier topics, and respect the configured maximum
      state.topics.forEach((t, i) => { const ok = new Set(earlier(i).map((x) => x.key)); t.prereqs = new Set([...t.prereqs].filter((k) => ok.has(k)).slice(0, maxP)); });
    };
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= state.topics.length) return; [state.topics[i], state.topics[j]] = [state.topics[j], state.topics[i]]; tidy(); paintList(); };
    const list = h('div', { class: 'rm-rows' });
    function paintList() {
      list.replaceChildren(...state.topics.map((t, i) => {
        const chips = earlier(i).map((p) => {
          const on = t.prereqs.has(p.key);
          const full = !on && t.prereqs.size >= maxP;
          return h('button', { type: 'button', class: `pchip${on ? ' on' : ''}`, disabled: full, title: full ? `At most ${maxP} prerequisites` : '', onclick: () => { on ? t.prereqs.delete(p.key) : t.prereqs.add(p.key); paintList(); } }, p.title || `Topic ${state.topics.indexOf(p) + 1}`);
        });
        return h('div', { class: 'card rm-row' },
          h('div', { class: 'rm-top' },
            h('span', { class: 'num' }, i + 1),
            h('input', { class: 'input', placeholder: 'Topic title', maxlength: 80, value: t.title, 'aria-label': `Topic ${i + 1} title`, oninput: (e) => (t.title = e.target.value) }),
            h('label', { class: 'hrs' }, h('input', { class: 'input', type: 'number', min: 0, max: 100, step: 0.5, value: t.hours, 'aria-label': 'Estimated hours', oninput: (e) => (t.hours = Number(e.target.value) || 0) }), h('span', null, 'h')),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, Icon('back')),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move down', disabled: i === state.topics.length - 1, onclick: () => move(i, 1), style: { transform: 'rotate(-90deg)' } }, Icon('arrow')),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove topic', onclick: () => { state.topics.splice(i, 1); tidy(); paintList(); } }, Icon('trash'))),
          h('div', { class: 'rm-pre' }, h('small', null, i === 0 ? 'First topic — nothing before it' : t.prereqs.size ? `Needs (${t.prereqs.size}/${maxP}):` : 'Needs nothing — open from the start. Pick prerequisites:'), h('div', { class: 'pchips' }, chips)));
      }));
    }

    function paint() {
      const total = () => Math.round(state.topics.reduce((a, t) => a + (Number(t.hours) || 0), 0));
      const title = h('input', { class: 'input', maxlength: 80, value: state.title, oninput: (e) => (state.title = e.target.value) });
      const desc = h('textarea', { class: 'textarea', maxlength: 500, rows: 2, oninput: (e) => (state.description = e.target.value) }, state.description);
      const target = h('input', { class: 'input', type: 'date', value: state.targetDate, oninput: (e) => (state.targetDate = e.target.value) });
      const sw = h('div', { class: 'qchips' });
      const paintSw = () => sw.replaceChildren(...COLORS.map((c) => h('button', { type: 'button', class: `c-${c}`, 'aria-label': c, 'aria-pressed': String(c === state.color), style: { width: '34px', height: '34px', padding: 0, borderRadius: '11px', background: 'var(--c)', border: c === state.color ? '2px solid var(--text)' : '2px solid transparent', transform: c === state.color ? 'scale(1.12)' : '' }, onclick: () => { state.color = c; paintSw(); } })));
      paintSw();
      paintList();
      const srcLabel = { gemini: 'Written by Gemini', template: 'From a built-in template', generic: 'Generic outline — rename and adjust it', blank: 'Blank outline' }[state.source];
      const errBox = h('div', { class: 'err-box', hidden: true });
      const submitBtn = h('button', { class: 'btn primary', type: 'button' }, Icon(assign ? 'send' : 'check'), assign ? 'Assign goal' : 'Create goal');
      submitBtn.addEventListener('click', () => UI.withBusy(submitBtn, async () => {
        errBox.hidden = true;
        const topics = state.topics.map((t) => ({ key: t.key, title: t.title.trim(), description: t.description, estimateMinutes: Math.round((Number(t.hours) || 0) * 60), prerequisites: [...t.prereqs] })).filter((t) => t.title);
        const keep = new Set(topics.map((t) => t.key));
        topics.forEach((t) => (t.prerequisites = t.prerequisites.filter((k) => keep.has(k))));
        const fail = (m) => { errBox.textContent = m; errBox.hidden = false; errBox.scrollIntoView({ block: 'nearest' }); };
        if (!state.title.trim()) return fail('Give the goal a title.');
        if (topics.length < 2) return fail('A roadmap needs at least two topics with titles.');
        const goal = { title: state.title, description: state.description, color: state.color, targetDate: state.targetDate };
        try {
          if (assign) {
            if (!state.learnerIds.size && !state.cohortIds.size) return fail('Choose at least one learner or cohort to assign this to.');
            const r = await API.assignGoal({ goal, topics, learnerIds: [...state.learnerIds], cohortIds: [...state.cohortIds], requireApproval: state.requireApproval });
            UI.toast(`Assigned to ${r.assignedTo.length} learner${r.assignedTo.length === 1 ? '' : 's'}`);
            App.go('/');
          } else {
            const r = await API.importGoal(goal, topics);
            UI.toast('Goal created from your roadmap');
            App.go(`/goals/${r.goal.id}`);
          }
        } catch (err) { fail(err.message + (err.details && err.details.fields ? ' ' + Object.values(err.details.fields).join(' ') : '')); }
      }));

      const assignPanel = assign ? h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Assign to'), h('p', { class: 'sub' }, 'Each learner gets their own copy of this goal. You manage its structure; they study it.'))),
        cohorts.cohorts.length ? h('div', { class: 'field' }, h('label', null, 'Cohorts'), h('div', { class: 'checklist' }, cohorts.cohorts.map((c) => checkRow(c.name, `${c.stats.learners} learners`, state.cohortIds, c.id)))) : null,
        h('div', { class: 'field' }, h('label', null, 'Individual learners'), h('div', { class: 'checklist' }, people.users.filter((u) => u.role === 'learner' && u.active).map((u) => checkRow(u.name, u.email, state.learnerIds, u.id)))),
        h('label', { class: 'check on', style: { marginTop: '8px' } }, h('input', { type: 'checkbox', checked: state.requireApproval, onchange: (e) => (state.requireApproval = e.target.checked) }), h('span', null, 'Require my approval before a topic counts as complete'))) : null;

      body.replaceChildren(
        h('div', { class: 'grid g-main' },
          h('div', { class: 'grid' },
            h('section', { class: 'card' },
              h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Goal details'), h('p', { class: 'sub' }, `${state.topics.length} topics · about ${total()} h of study`)), srcLabel ? h('span', { class: 'src' }, Icon('sparkles'), srcLabel) : null),
              UI.field('Goal title', title, 'title'), UI.field('Description', desc, 'description'),
              h('div', { class: 'row' }, UI.field('Target date', target, 'targetDate', 'Optional — enables the deadline forecast'), h('div', { class: 'field' }, h('label', null, 'Colour'), sw))),
            h('div', { class: 'card-head', style: { margin: '6px 0 -4px' } }, h('div', null, h('h3', { style: { fontSize: '19px' } }, 'Topics & prerequisites'), h('p', { class: 'sub' }, 'Reorder, rename, estimate hours and choose what each topic needs. Loops are impossible: prerequisites can only be earlier topics.'))),
            list,
            h('button', { class: 'btn', type: 'button', onclick: () => { state.topics.push({ key: newKey(), title: '', description: '', hours: 4, prereqs: new Set() }); paintList(); } }, Icon('plus'), 'Add topic')),
          h('div', { class: 'grid', style: { alignContent: 'start' } }, assignPanel, h('div', { class: 'card' }, errBox, h('div', { class: 'actions' }, submitBtn, h('button', { class: 'btn', type: 'button', onclick: () => { state.topics = []; state.source = null; body.replaceChildren(); startForm.scrollIntoView({ block: 'center' }); } }, 'Start over'))))));
    }
    function checkRow(label, small, set, id) {
      const cb = h('input', { type: 'checkbox', checked: set.has(id) });
      const row = h('label', { class: `check${set.has(id) ? ' on' : ''}` }, cb, h('span', null, label), h('small', { class: 'hint', style: { marginLeft: 'auto' } }, small));
      cb.addEventListener('change', () => { cb.checked ? set.add(id) : set.delete(id); row.classList.toggle('on', cb.checked); });
      return row;
    }

    root.append(
      h('div', { class: 'topbar' }, h('div', null, h('h1', null, assign ? 'Assign a goal' : 'Roadmap generator'), h('p', { class: 'sub' }, assign ? 'Describe the subject, review the proposed path, then assign it to learners or whole cohorts.' : 'Tell Pathwise what you want to learn and get a proposed set of topics with prerequisites. You review it before anything is saved.'))),
      h('section', { class: 'card tilt c-violet reveal' }, h('h3', { style: { marginBottom: '12px' } }, assign ? 'What should they learn?' : 'What do you want to learn?'), startForm,
        h('div', { class: 'hint', style: { marginTop: '10px' } }, 'Or ', h('button', { class: 'linklike', type: 'button', onclick: blank }, 'start from a blank outline'), '.'),
        h('div', { class: 'qchips', style: { marginTop: '12px' } }, ['Learn Rust', 'Python for data', 'SQL', 'Machine learning', 'Cloud & DevOps'].map((s) => h('button', { type: 'button', onclick: () => { subject.value = s; startForm.requestSubmit(); } }, s)))),
      h('div', { style: { height: '18px' } }), body);
    return root;
  };
})();
