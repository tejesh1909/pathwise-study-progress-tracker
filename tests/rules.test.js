/* Pure business-rule tests — no database needed. Run: npm run test:rules */
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../shared/rules');
const SeedData = require('../shared/seed-data');

const T = (id, prerequisites = [], complete = false, extra = {}) => ({ id, title: id.toUpperCase(), goalId: 'g', prerequisites, complete, ...extra });
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof R.RuleError && e.code === code, `expected RuleError ${code}`);
const apply = (topics, ids) => topics.map((t) => (ids.includes(t.id) ? { ...t, complete: false } : t));

/* ------------------------------------------------------------- unlock rule */
test('a topic is locked until ALL its prerequisites are complete, and the missing ones are listed', () => {
  const topics = [T('a', [], true), T('b', [], false), T('c', ['a', 'b'])];
  const s = R.computeStates(topics);
  assert.equal(s.a.state, 'complete');
  assert.equal(s.b.state, 'available');
  assert.equal(s.c.state, 'locked');
  assert.deepEqual(s.c.missing, ['b']);
  const after = R.computeStates(topics.map((t) => (t.id === 'b' ? { ...t, complete: true } : t)));
  assert.equal(after.c.state, 'available');
  assert.deepEqual(after.c.missing, []);
});

test('completing a locked topic is rejected with the list of missing prerequisites', () => {
  const topics = [T('a'), T('b', ['a'])];
  try {
    R.planComplete(topics, 'b');
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.code, 'LOCKED');
    assert.deepEqual(e.details.missing.map((m) => m.id), ['a']);
    assert.match(e.message, /A/);
  }
  assert.deepEqual(R.planComplete(topics, 'a').changed, ['a']);
});

test('in_progress is derived from logged minutes on an unlocked topic', () => {
  const topics = [T('a'), T('b', ['a'])];
  assert.equal(R.computeStates(topics, { a: 30 }).a.state, 'in_progress');
  assert.equal(R.computeStates(topics, { b: 30 }).b.state, 'locked'); // minutes never override a lock
});

/* ---------------------------------------------- reopening re-locks dependents */
test('reopening a topic re-locks its dependents (cascade policy reopens completed dependents too)', () => {
  const topics = [T('a', [], true), T('b', ['a'], true), T('c', ['b'], true), T('d', [], true)];
  const plan = R.planReopen(topics, 'a', { ...R.DEFAULT_CONFIG, reopenPolicy: 'cascade' });
  assert.deepEqual(plan.reopened.sort(), ['a', 'b', 'c']);
  assert.deepEqual(plan.relocked.map((r) => r.id).sort(), ['b', 'c']);
  const s = R.computeStates(apply(topics, plan.reopened));
  assert.equal(s.a.state, 'available');
  assert.equal(s.b.state, 'locked');
  assert.equal(s.c.state, 'locked');
  assert.equal(s.d.state, 'complete'); // unrelated topic untouched
});

test('with a cascade-free reopen, an already-incomplete dependent simply becomes locked', () => {
  const topics = [T('a', [], true), T('b', ['a'], false)];
  assert.equal(R.computeStates(topics).b.state, 'available');
  const plan = R.planReopen(topics, 'a');
  const s = R.computeStates(apply(topics, plan.reopened));
  assert.equal(s.b.state, 'locked');
  assert.deepEqual(s.b.missing, ['a']);
});

test('block policy refuses to reopen while completed dependents exist', () => {
  const topics = [T('a', [], true), T('b', ['a'], true)];
  throwsCode(() => R.planReopen(topics, 'a', { ...R.DEFAULT_CONFIG, reopenPolicy: 'block' }), 'CONFLICT');
  // but a topic with no completed dependents can be reopened
  assert.deepEqual(R.planReopen(topics, 'b', { ...R.DEFAULT_CONFIG, reopenPolicy: 'block' }).reopened, ['b']);
});

test('reopening a topic that is not complete is a no-op', () => {
  assert.deepEqual(R.planReopen([T('a')], 'a').reopened, []);
});

/* ------------------------------------------------------ prerequisite checks */
test('a prerequisite that points to the topic itself is rejected', () => {
  const topics = [T('a'), T('b')];
  try {
    R.validatePrerequisites({ topics, topicId: 'a', prerequisites: ['a'], config: R.DEFAULT_CONFIG });
    assert.fail();
  } catch (e) {
    assert.equal(e.code, 'VALIDATION');
    assert.equal(e.details.reason, 'self');
  }
});

test('direct and indirect loops are rejected, with the loop in the message', () => {
  // c needs b needs a.  Making a need c would close the loop a → c → b → a.
  const topics = [T('a'), T('b', ['a']), T('c', ['b'])];
  try {
    R.validatePrerequisites({ topics, topicId: 'a', prerequisites: ['c'], config: R.DEFAULT_CONFIG });
    assert.fail();
  } catch (e) {
    assert.equal(e.details.reason, 'cycle');
    assert.deepEqual(e.details.path, ['a', 'c', 'b', 'a']);
    assert.match(e.message, /loop/);
  }
  // direct two-node loop
  throwsCode(() => R.validatePrerequisites({ topics: [T('x'), T('y', ['x'])], topicId: 'x', prerequisites: ['y'], config: R.DEFAULT_CONFIG }), 'VALIDATION');
  // a diamond is NOT a loop
  const diamond = [T('a'), T('b', ['a']), T('c', ['a']), T('d')];
  assert.deepEqual(R.validatePrerequisites({ topics: diamond, topicId: 'd', prerequisites: ['b', 'c'], config: R.DEFAULT_CONFIG }), ['b', 'c']);
});

test('duplicates and unknown prerequisites are rejected; new topics skip the loop check', () => {
  const topics = [T('a'), T('b')];
  throwsCode(() => R.validatePrerequisites({ topics, topicId: 'b', prerequisites: ['a', 'a'], config: R.DEFAULT_CONFIG }), 'VALIDATION');
  throwsCode(() => R.validatePrerequisites({ topics, topicId: 'b', prerequisites: ['zzz'], config: R.DEFAULT_CONFIG }), 'VALIDATION');
  assert.deepEqual(R.validatePrerequisites({ topics, topicId: null, prerequisites: ['a', 'b'], config: R.DEFAULT_CONFIG }), ['a', 'b']);
});

test('the maximum number of prerequisites is configurable and changes behaviour without a code change', () => {
  const topics = [T('a'), T('b'), T('c'), T('d')];
  const ask = (max) => () => R.validatePrerequisites({ topics, topicId: 'd', prerequisites: ['a', 'b', 'c'], config: { ...R.DEFAULT_CONFIG, maxPrerequisitesPerTopic: max } });
  throwsCode(ask(2), 'VALIDATION');
  assert.deepEqual(ask(3)(), ['a', 'b', 'c']);
  assert.deepEqual(ask(5)(), ['a', 'b', 'c']);
});

/* ---------------------------------------------------------------- sessions */
const TODAY = '2026-11-15';
const openTopic = { id: 'a', title: 'A' };
const okState = { locked: false, missing: [] };
const session = (over, cfg) => R.validateSession({ input: { date: TODAY, minutes: 30, note: 'ok', ...over }, topic: openTopic, state: okState, config: cfg || R.DEFAULT_CONFIG, today: TODAY });

test('default minutes limits are 5 to 480 inclusive', () => {
  assert.equal(session({ minutes: 5 }).minutes, 5);
  assert.equal(session({ minutes: 480 }).minutes, 480);
  for (const bad of [4, 481, 0, -10, 12.5, 'abc']) throwsCode(() => session({ minutes: bad }), 'VALIDATION');
  assert.equal(session({ minutes: '45' }).minutes, 45); // form posts strings
});

test('changing the configured minimum/maximum changes what is accepted', () => {
  const cfg = { ...R.DEFAULT_CONFIG, minSessionMinutes: 15, maxSessionMinutes: 120 };
  throwsCode(() => session({ minutes: 10 }, cfg), 'VALIDATION');
  throwsCode(() => session({ minutes: 121 }, cfg), 'VALIDATION');
  assert.equal(session({ minutes: 15 }, cfg).minutes, 15);
  assert.equal(session({ minutes: 120 }, cfg).minutes, 120);
  assert.equal(session({ minutes: 10 }).minutes, 10); // still fine under the defaults
});

test('future dates and impossible dates are rejected', () => {
  throwsCode(() => session({ date: '2026-11-16' }), 'VALIDATION');
  throwsCode(() => session({ date: '2027-01-01' }), 'VALIDATION');
  throwsCode(() => session({ date: '2026-02-30' }), 'VALIDATION');
  throwsCode(() => session({ date: 'yesterday' }), 'VALIDATION');
  assert.equal(session({ date: '2026-11-14' }).date, '2026-11-14');
  assert.equal(session({ date: TODAY }).date, TODAY);
});

test('field errors are reported together, keyed by field', () => {
  try {
    session({ date: '2999-01-01', minutes: 1 });
    assert.fail();
  } catch (e) {
    assert.deepEqual(Object.keys(e.details.fields).sort(), ['date', 'minutes']);
  }
});

test('no sessions can be logged against a locked topic', () => {
  try {
    R.validateSession({ input: { date: TODAY, minutes: 30 }, topic: openTopic, state: { locked: true, missing: ['x'] }, config: R.DEFAULT_CONFIG, today: TODAY });
    assert.fail();
  } catch (e) {
    assert.equal(e.code, 'LOCKED');
  }
});

/* ----------------------------------------------------------------- config */
test('configuration is validated and merged over the defaults', () => {
  const cfg = R.validateConfig({ minSessionMinutes: '10', maxSessionMinutes: 90 });
  assert.equal(cfg.minSessionMinutes, 10);
  assert.equal(cfg.maxSessionMinutes, 90);
  assert.equal(cfg.maxPrerequisitesPerTopic, R.DEFAULT_CONFIG.maxPrerequisitesPerTopic);
  throwsCode(() => R.validateConfig({ minSessionMinutes: 100, maxSessionMinutes: 50 }), 'VALIDATION');
  throwsCode(() => R.validateConfig({ minSessionMinutes: 0 }), 'VALIDATION');
  throwsCode(() => R.validateConfig({ maxSessionMinutes: 5000 }), 'VALIDATION');
  throwsCode(() => R.validateConfig({ maxPrerequisitesPerTopic: -1 }), 'VALIDATION');
  throwsCode(() => R.validateConfig({ reopenPolicy: 'chaos' }), 'VALIDATION');
});

/* --------------------------------------------------------------- progress */
test('goal progress: percent of topics complete and total minutes', () => {
  const topics = [T('a', [], true), T('b', [], true), T('c'), T('d')];
  const p = R.goalProgress(topics, [
    { topicId: 'a', minutes: 30 },
    { topicId: 'a', minutes: 20 },
    { topicId: 'c', minutes: 10 },
  ]);
  assert.equal(p.percent, 50);
  assert.equal(p.completeTopics, 2);
  assert.equal(p.totalMinutes, 60);
  assert.deepEqual(p.minutesByTopic, { a: 50, c: 10 });
  assert.equal(R.goalProgress([], []).percent, 0);
});

test('weekly series, heatmap and streak', () => {
  const sessions = [
    { date: TODAY, minutes: 30, topicId: 'a' },
    { date: '2026-11-14', minutes: 20, topicId: 'a' },
    { date: '2026-11-13', minutes: 10, topicId: 'a' },
    { date: '2026-11-08', minutes: 50, topicId: 'a' }, // previous 7-day bucket
    { date: '2026-09-01', minutes: 99, topicId: 'a' }, // outside the window
  ];
  const w = R.weeklySeries(sessions, TODAY, 6);
  assert.equal(w.length, 6);
  assert.equal(w[5].minutes, 60);
  assert.equal(w[4].minutes, 50);
  assert.equal(w.reduce((a, b) => a + b.minutes, 0), 110);
  const h = R.heatmap(sessions, TODAY, 42);
  assert.equal(h.length, 42);
  assert.equal(h[41].date, TODAY);
  assert.equal(R.streak(sessions, TODAY), 3);
  assert.equal(R.streak(sessions.slice(1), TODAY), 2); // grace: today not studied yet
  assert.equal(R.streak([], TODAY), 0);
});

test('todayInTz respects the time zone', () => {
  const instant = new Date('2026-11-15T20:00:00Z'); // 01:30 on the 16th in India
  assert.equal(R.todayInTz('UTC', instant), '2026-11-15');
  assert.equal(R.todayInTz('Asia/Kolkata', instant), '2026-11-16');
});

/* --------------------------------------------------------------- insights */
test('suggested plan only contains unlocked topics, within the configured session limits', () => {
  const topics = [T('a', [], true), T('b', ['a']), T('c', ['b']), T('d', [], false)];
  const sessions = [{ topicId: 'b', minutes: 30, date: '2026-11-10' }];
  const plan = R.suggestPlan({ topics, sessions, config: R.DEFAULT_CONFIG, today: TODAY });
  const ids = plan.items.map((i) => i.topicId);
  assert.ok(!ids.includes('c'), 'locked topic must never be suggested');
  assert.ok(!ids.includes('a'), 'complete topic must not be suggested');
  assert.equal(ids[0], 'b'); // in progress comes first
  assert.match(plan.items[0].reason, /unlocks C/);
  for (const i of plan.items) assert.ok(i.minutes >= 5 && i.minutes <= 480);
});

test('weekly review compares the last 7 days with the previous 7', () => {
  const topics = [T('a', [], true, { completedOn: '2026-11-12' }), T('b')];
  const sessions = [
    { topicId: 'a', minutes: 60, date: '2026-11-12' },
    { topicId: 'b', minutes: 40, date: '2026-11-14' },
    { topicId: 'b', minutes: 50, date: '2026-11-07' },
  ];
  const r = R.buildReview({ topics, sessions, config: R.DEFAULT_CONFIG, today: TODAY });
  assert.equal(r.minutes, 100);
  assert.equal(r.previousMinutes, 50);
  assert.equal(r.deltaPercent, 100);
  assert.deepEqual(r.completed, ['A']);
  assert.match(R.narrate(r, 'Aarav Mehta'), /Aarav studied 1h 40m/);
});

/* ------------------------------------------------------------- seed data */
test('seed data matches the brief and respects its own rules', () => {
  const d = SeedData.build(TODAY);
  assert.equal(d.goals.length, 3);
  assert.equal(d.topics.length, 12);
  assert.equal(d.sessions.length, 30);

  const keys = new Set(d.topics.map((t) => t.key));
  const goalOf = Object.fromEntries(d.topics.map((t) => [t.key, t.goal]));
  assert.ok(d.topics.filter((t) => t.prereqs.length).length >= 8, 'most topics should have prerequisites');
  for (const t of d.topics) {
    assert.ok(t.prereqs.length <= R.DEFAULT_CONFIG.maxPrerequisitesPerTopic);
    for (const p of t.prereqs) {
      assert.ok(keys.has(p), `${t.key} → unknown prerequisite ${p}`);
      assert.equal(goalOf[p], t.goal, 'prerequisites stay inside a goal');
    }
  }
  // no loops: validate each topic against the others
  const asTopics = d.topics.map((t) => ({ id: t.key, title: t.title, prerequisites: t.prereqs }));
  for (const t of asTopics) assert.equal(R.findCyclePath(asTopics, t.id, t.prerequisites), null);

  // sessions span six weeks, none in the future, valid under the default limits
  const dates = d.sessions.map((s) => s.date).sort();
  assert.ok(R.diffDays(dates[dates.length - 1], dates[0]) >= 38 && R.diffDays(dates[dates.length - 1], dates[0]) <= 42);
  assert.ok(dates[dates.length - 1] <= TODAY);
  for (const s of d.sessions) assert.ok(s.minutes >= 5 && s.minutes <= 480);

  // history is consistent: a session never predates the completion of any prerequisite of its topic,
  // and completion happens after the prerequisites were completed.
  const byKey = Object.fromEntries(d.topics.map((t) => [t.key, t]));
  for (const s of d.sessions) {
    for (const p of byKey[s.topic].prereqs) assert.ok(byKey[p].completedOn && byKey[p].completedOn <= s.date, `${s.topic} session on ${s.date} before ${p} was complete`);
    if (byKey[s.topic].completedOn) assert.ok(s.date <= byKey[s.topic].completedOn, `${s.topic} studied after completion`);
  }
  for (const t of d.topics) if (t.completedOn) for (const p of t.prereqs) assert.ok(byKey[p].completedOn && byKey[p].completedOn <= t.completedOn);

  // a good mix of states for the demo
  const states = R.computeStates(d.topics.map((t) => ({ id: t.key, prerequisites: t.prereqs, complete: !!t.completedOn })));
  const kinds = new Set(Object.values(states).map((s) => s.state));
  assert.ok(kinds.has('complete') && kinds.has('available') && kinds.has('locked'));
});
