/* Mentor: topics learners have submitted for approval. */
window.Views = window.Views || {};
(function () {
  'use strict';
  Views.approvals = async function () {
    let { approvals } = await API.approvals();
    const root = h('div');
    const reject = (a) => UI.modal((close) => {
      const ta = h('textarea', { class: 'textarea', maxlength: 300, rows: 4, placeholder: 'What should they fix or revisit?' });
      const btn = h('button', { class: 'btn danger', type: 'submit' }, Icon('undo'), 'Send back');
      const f = h('form', { novalidate: true }, UI.field('Feedback for ' + a.learnerName.split(' ')[0], ta, 'comment'), h('div', { class: 'foot' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), btn));
      f.addEventListener('submit', (e) => { e.preventDefault(); UI.withBusy(btn, async () => { try { await API.rejectTopic(a.topicId, ta.value); close(); UI.toast('Sent back with feedback', 'info'); refresh(); } catch (err) { UI.applyApiError(f, err); } }); });
      return h('div', null, h('h2', null, `Send back “${a.title}”`), h('p', { class: 'sub' }, 'The topic returns to the learner, who keeps its study time. Anything that depends on it stays locked.'), f);
    });
    const approve = async (a, btn) => UI.withBusy(btn, async () => { try { await API.approveTopic(a.topicId); UI.toast(`Approved “${a.title}” — dependants unlocked`); const r = btn.getBoundingClientRect(); UI.confetti(r.left + r.width / 2, r.top); refresh(); } catch (err) { UI.toast(err.message, 'err'); } });
    async function refresh() { approvals = (await API.approvals()).approvals; paint(); App.refreshBadge && App.refreshBadge(); }
    function paint() {
      root.replaceChildren(
        h('div', { class: 'topbar' }, h('div', null, h('h1', null, 'Approvals'), h('p', { class: 'sub' }, approvals.length ? `${approvals.length} topic${approvals.length === 1 ? '' : 's'} waiting for your review` : 'Topics learners submit on goals that need approval show up here.'))),
        approvals.length ? h('div', { class: 'list' }, approvals.map((a, i) => h('article', { class: `card appr c-${a.color} reveal`, style: { '--i': i } },
          h('div', { class: 'appr-main' }, h('span', { class: 'sico pending' }, Icon('hourglass')), h('div', null, h('b', null, a.title), h('small', null, `${a.learnerName} · ${a.goalTitle}`), h('small', null, `${UI.fmtMin(a.minutes)} studied${a.estimateMinutes ? ' of ' + UI.fmtMin(a.estimateMinutes) + ' estimated' : ''}`))),
          h('div', { class: 'actions' },
            h('a', { class: 'btn sm', href: `#/goals/${a.goalId}?topic=${a.topicId}` }, Icon('eye'), 'Open'),
            h('button', { class: 'btn sm danger', onclick: () => reject(a) }, Icon('undo'), 'Send back'),
            h('button', { class: 'btn sm mint', onclick: (e) => approve(a, e.currentTarget) }, Icon('check'), 'Approve')))))
          : h('div', { class: 'card empty' }, Icon('check'), h('h3', null, 'All caught up'), h('p', null, 'Nothing is waiting for approval.')));
    }
    paint();
    return root;
  };
})();
