window.Views = window.Views || {};
(function () {
  'use strict';

  Views.goalCard = function (g, i) {
    const p = g.progress;
    return h('article', { class: `card tilt goal-card c-${g.color}`, tabindex: 0, role: 'link', onclick: () => App.go(`/goals/${g.id}`), onkeydown: (e) => e.key === 'Enter' && App.go(`/goals/${g.id}`) },
      h('div', { class: 'goal-top' },
        Charts.ring({ percent: p.percent, size: 76, stroke: 8, color: g.color }),
        h('div', null, h('h3', null, g.title), g.description ? h('p', null, g.description) : null)),
      h('div', { class: 'meta' },
        h('span', null, Icon('check'), `${p.completeTopics} of ${p.totalTopics} topics`),
        h('span', null, Icon('clock'), UI.fmtMin(p.totalMinutes)),
        g.locked ? h('span', null, Icon('lock'), `${g.locked} locked`) : null,
        g.targetDate ? h('span', null, Icon('flag'), UI.fmtDate(g.targetDate)) : null,
        g.pendingCount ? h('span', { class: 'tag' }, Icon('hourglass'), `${g.pendingCount} awaiting approval`) : null,
        g.assigned ? h('span', { class: 'tag' }, Icon('send'), 'Assigned') : null,
        UI.forecastChip(g.forecast)),
      g.nextUp
        ? h('div', { class: 'next' }, Icon(g.nextUp.state === 'in_progress' ? 'clock' : 'play'), h('span', null, g.nextUp.state === 'in_progress' ? 'Continue ' : 'Start ', h('b', null, g.nextUp.title)))
        : h('div', { class: 'next' }, Icon(p.percent === 100 && p.totalTopics ? 'check' : 'info'), h('span', null, p.totalTopics ? (p.percent === 100 ? 'Goal complete — nicely done.' : 'Everything left is locked behind prerequisites.') : 'Add your first topic to begin.'))
    );
  };

  function alertsBox(d, view) {
    if (!d.alerts || !d.alerts.length) return null;
    return h('section', { class: 'card alerts reveal', style: { marginTop: '18px' } },
      h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Deadline warnings'), h('p', { class: 'sub' }, view ? 'Goals that are unlikely to finish by their target date' : 'These goals are unlikely to finish by their target date at your current pace'))),
      h('div', { class: 'list' }, d.alerts.map((a) => h('div', { class: `li click c-${a.color}`, onclick: () => App.go(`/goals/${a.goalId}`) }, h('span', { class: `sico ${a.status === 'at_risk' ? 'in_progress' : 'locked'}`, style: { color: `var(--${UI.FC_COLOR[a.status]})` } }, Icon('alert')), h('div', { class: 'grow' }, h('b', { style: { whiteSpace: 'normal' } }, a.title), h('small', { style: { whiteSpace: 'normal' } }, a.headline)), UI.forecastChip({ status: a.status, headline: a.headline })))));
  }

  Views.dashboard = async function ({ learnerId }) {
    const d = await API.dashboard(learnerId);
    const view = !!learnerId; // a mentor looking at a learner
    const first = d.learner.name.split(' ')[0];
    const target = d.config.weeklyTargetMinutes;
    const pct = Math.min(100, Math.round((d.totals.weekMinutes / target) * 100));
    const ready = d.readyToStart.length;

    const goalsGrid = h('div', { class: 'grid g-3' }, d.goals.map((g, i) => Views.goalCard(g, i)));
    if (!view) {
      goalsGrid.append(
        h('button', { class: 'card add-card', onclick: () => Views.goalModal({ onSaved: (r) => App.go(`/goals/${r.goal.id}`) }) },
          h('div', null, h('div', { class: 'plus' }, Icon('plus')), h('b', null, 'New goal'), h('p', { class: 'sub' }, 'Group topics under something you want to master')))
      );
    } else if (!d.goals.length) {
      goalsGrid.append(h('div', { class: 'card empty', style: { gridColumn: '1/-1' } }, Icon('book'), h('p', null, `${first} hasn't created any goals yet.`)));
    }
    UI.stagger([...goalsGrid.children]);

    const kpi = (icon, color, value, label, i) =>
      h('div', { class: `card tilt kpi c-${color}` }, h('div', { class: 'ico' }, Icon(icon)), h('div', null, h('b', null, value), h('span', null, label)));
    const kpis = [
      kpi('target', 'violet', UI.counter(d.totals.goals), 'Active goals'),
      kpi('check', 'mint', h('span', null, UI.counter(d.totals.topicsComplete), h('small', { style: { fontSize: '15px', color: 'var(--muted)' } }, ` / ${d.totals.topics}`)), 'Topics complete'),
      kpi('clock', 'cyan', UI.counter(d.totals.minutes, { fmt: (n) => UI.fmtMin(n) }), 'Total time studied'),
      kpi('lock', 'amber', UI.counter(d.totals.locked), 'Topics still locked'),
    ];
    UI.stagger(kpis);

    const recentList = d.recent.length
      ? h('div', { class: 'list' }, d.recent.map((s) => h('div', { class: `li c-${s.goalColor}` }, h('span', { class: 'dot' }), h('div', { class: 'grow' }, h('b', null, s.topicTitle), h('small', null, s.note || s.goalTitle)), h('div', { class: 'end' }, UI.fmtMin(s.minutes), h('small', null, UI.relDay(s.date, d.today))))))
      : h('div', { class: 'empty' }, Icon('clock'), h('p', null, 'No sessions logged yet.'));

    const readyList = ready
      ? h('div', { class: 'list' }, d.readyToStart.map((t) => h('div', { class: `li click c-${t.color || 'violet'}`, onclick: () => App.go(`/goals/${t.goalId}?topic=${t.id}`) }, UI.stateIcon(t.state), h('div', { class: 'grow' }, h('b', null, t.title), h('small', null, t.goalTitle)), Icon('arrow'))))
      : h('div', { class: 'empty' }, Icon('lock'), h('p', null, 'Nothing is unlocked right now.'));

    const page = h('div', null,
      h('div', { class: 'topbar' },
        h('div', null, h('h1', null, view ? `${d.learner.name}` : 'Dashboard'), h('p', { class: 'sub' }, view ? 'Learner overview · view-only (assigned goals can be managed by mentors)' : new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))),
        h('div', { class: 'actions' },
          view ? h('button', { class: 'btn', onclick: () => App.go(`/learners/${d.learner.id}/insights`) }, Icon('sparkles'), 'Weekly review') : null,
          !view ? h('button', { class: 'btn', onclick: () => App.go('/roadmap') }, Icon('wand'), 'Roadmap generator') : null,
          !view ? h('button', { class: 'btn', onclick: () => Views.goalModal({ onSaved: (r) => App.go(`/goals/${r.goal.id}`) }) }, Icon('plus'), 'New goal') : null,
          h('div', { style: { display: 'contents' } }, Views.exportMenu({ learnerId: view ? learnerId : undefined })),
          !view ? h('button', { class: 'btn primary', onclick: () => App.go('/log') }, Icon('bolt'), 'Log session') : null)),
      view ? h('div', { class: 'banner' }, Icon('eye'), h('span', null, `You're viewing ${d.learner.name}'s progress as a mentor. Learners edit their own goals; mentors can read everything and leave feedback.`)) : null,
      h('section', { class: 'card tilt hero c-violet reveal' },
        h('div', null,
          h('h2', null, view ? `${first}'s week` : `${UI.greeting()}, ${first}`),
          h('p', null, view
            ? `${UI.fmtMin(d.totals.weekMinutes)} studied in the last 7 days — ${pct}% of the ${UI.fmtMin(target)} weekly target.`
            : ready ? `${ready} topic${ready === 1 ? ' is' : 's are'} unlocked and waiting${d.totals.locked ? `, with ${d.totals.locked} more behind prerequisites` : ''}. ${pct >= 100 ? 'You have already hit this week’s target.' : `${UI.fmtMin(Math.max(0, target - d.totals.weekMinutes))} to hit this week's target.`}` : 'Create a goal and add topics to see your progress here.'),
          h('div', { class: 'chips' },
            h('span', { class: `chip${d.streak ? ' flame' : ''}` }, Icon('flame'), d.streak ? `${d.streak}-day streak` : 'No streak yet'),
            h('span', { class: 'chip' }, Icon('target'), `Target ${UI.fmtMin(target)}/week`),
            h('span', { class: 'chip' }, Icon('book'), `${d.totals.sessions} sessions`))),
        Charts.ring({ percent: pct, size: 136, stroke: 11, fs: 26, color: 'cyan', label: h('div', { style: { textAlign: 'center', lineHeight: 1.1 } }, h('div', { style: { fontSize: '25px' } }, UI.counter(d.totals.weekMinutes, { fmt: (n) => UI.fmtMin(n) })), h('small', { style: { fontSize: '11px', opacity: 0.7, fontWeight: 500, fontFamily: 'var(--font)' } }, 'last 7 days')) })),
      alertsBox(d, view),
      h('div', { class: 'grid g-4 kpis', style: { margin: '18px 0 30px' } }, kpis),
      h('div', { class: 'card-head' }, h('div', null, h('h3', { style: { fontSize: '21px' } }, 'Goals'), h('p', { class: 'sub' }, 'Open a goal to see its prerequisite map'))),
      goalsGrid,
      h('div', { class: 'grid g-main', style: { marginTop: '30px' } },
        h('div', { class: 'grid' },
          h('section', { class: 'card tilt reveal', style: { '--i': 4 } }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Study time per week'), h('p', { class: 'sub' }, 'Rolling 7-day blocks, last six weeks'))), Charts.bars({ data: d.weekly.map((w, i) => ({ label: i === d.weekly.length - 1 ? 'Now' : UI.fmtDate(w.start), value: w.minutes, tip: `${UI.fmtDate(w.start)} – ${UI.fmtDate(w.end)}` })), valueFmt: UI.fmtMin, highlightLast: true })),
          h('section', { class: 'card tilt reveal', style: { '--i': 5 } }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Consistency'), h('p', { class: 'sub' }, 'Every square is a day · last six weeks'))), Charts.heatmap(d.heatmap))),
        h('div', { class: 'grid' },
          h('section', { class: 'card tilt reveal', style: { '--i': 6 } }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Ready to start'), h('p', { class: 'sub' }, 'Unlocked topics across your goals'))), readyList),
          h('section', { class: 'card tilt reveal', style: { '--i': 7 } }, h('div', { class: 'card-head' }, h('div', null, h('h3', null, 'Recent activity'))), recentList)))
    );
    return page;
  };
})();
