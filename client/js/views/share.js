/* Public, read-only view of one goal, opened from a share link. */
window.Views = window.Views || {};
(function () {
  'use strict';
  Views.sharedGoal = async function ({ token }) {
    const d = await API.sharedGoal(token);
    const g = d.goal, p = d.progress;
    const topics = d.topics.map((t) => ({ ...t, complete: t.state === 'complete', dependents: [] }));
    const weekly = d.weekly.map((w, i) => ({ label: i === d.weekly.length - 1 ? 'Now' : UI.fmtDate(w.start), value: w.minutes, tip: `${UI.fmtDate(w.start)} – ${UI.fmtDate(w.end)}` }));
    return h('div', { class: 'pub' },
      h('header', { class: 'lnav slim' }, h('a', { href: '#/', class: 'lbrand' }, App.brand(false)), h('div', { class: 'lactions' }, App.themeBtn(), h('a', { class: 'btn sm primary', href: '#/register' }, 'Start your own'))),
      h('div', { class: 'pub-wrap' },
        h('div', { class: 'banner' }, Icon('eye'), h('span', null, `Read-only snapshot shared by ${d.learnerFirstName}.${d.expiresAt ? ' This link expires ' + UI.fmtDate(String(d.expiresAt).slice(0, 10)) + '.' : ''}`)),
        h('section', { class: `card goal-hero c-${g.color}` },
          Charts.ring({ percent: p.percent, size: 112, stroke: 10, fs: 24, color: g.color }),
          h('div', { style: { flex: 1, minWidth: 0 } }, h('h1', null, g.title), g.description ? h('p', null, g.description) : h('p'),
            h('div', { class: 'meta' }, h('span', null, Icon('check'), `${p.completeTopics}/${p.totalTopics} topics`), h('span', null, Icon('clock'), UI.fmtMin(p.totalMinutes)), g.targetDate ? h('span', null, Icon('flag'), `Target ${UI.fmtDate(g.targetDate)}`) : null, UI.forecastChip(d.forecast)))),
        h('div', { class: 'grid', style: { marginTop: '18px' } },
          Views.forecastCard(d.forecast, g),
          h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Prerequisite map'), h('p', { class: 'sub' }, 'What is done, what is ready, and what is still locked'))), Charts.topicGraph({ topics, selectedId: null, fresh: null, done: null, onSelect: () => {} })),
          h('section', { class: `card c-${g.color}` }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Study time per week'))), Charts.area({ data: weekly, valueFmt: UI.fmtMin })))));
  };
})();
