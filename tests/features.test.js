/* Pure tests for the new feature logic (no database): approval rules, estimates/notes/links, forecast, habits + schedule,
 * roadmap sanitising, quiz, coach, CSV. Run: npm run test:rules */
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../shared/rules');
const F = require('../shared/features');
const SeedData = require('../shared/seed-data');

const TODAY = '2026-11-15'; // a Sunday
const T = (id, prerequisites = [], complete = false, extra = {}) => ({ id, title: id.toUpperCase(), goalId: 'g', prerequisites, complete, ...extra });
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof R.RuleError && e.code === code, `expected RuleError ${code}`);

/* ------------------------------------------------------- approval workflow */
test('with approval required, completing only submits: the topic is pending and its dependents stay locked', () => {
  const topics = [T('a'), T('b', ['a'])];
  const plan = R.planComplete(topics, 'a', { needsApproval: true });
  assert.deepEqual(plan, { changed: ['a'], pending: true });
  const submitted = topics.map((t) => (t.id === 'a' ? { ...t, pending: true } : t));
  const s = R.computeStates(submitted);
  assert.equal(s.a.state, 'pending');
  assert.equal(s.b.state, 'locked'); // not unlocked until approved
  assert.deepEqual(s.b.missing, ['a']);
  assert.deepEqual(R.planComplete(submitted, 'a', { needsApproval: true }), { changed: [], pending: true }); // idempotent
});

test('without approval required, completing works exactly as before', () => {
  assert.deepEqual(R.planComplete([T('a')], 'a'), { changed: ['a'], pending: false });
  assert.deepEqual(R.planComplete([T('a')], 'a', { needsApproval: false }), { changed: ['a'], pending: false });
});

test('a locked topic cannot even be submitted for approval', () => {
  throwsCode(() => R.planComplete([T('a'), T('b', ['a'])], 'b', { needsApproval: true }), 'LOCKED');
});

test('approve and reject only work on a submitted topic', () => {
  const topics = [T('a', [], false, { pending: true }), T('b'), T('c', [], true)];
  assert.deepEqual(R.planApprove(topics, 'a').changed, ['a']);
  assert.deepEqual(R.planReject(topics, 'a').changed, ['a']);
  throwsCode(() => R.planApprove(topics, 'b'), 'CONFLICT'); // never submitted
  throwsCode(() => R.planReject(topics, 'b'), 'CONFLICT');
  throwsCode(() => R.planApprove(topics, 'c'), 'CONFLICT'); // already approved
  throwsCode(() => R.planApprove(topics, 'zzz'), 'NOT_FOUND');
});

test('reopening a prerequisite also withdraws submissions that depended on it', () => {
  const topics = [T('a', [], true), T('b', ['a'], false, { pending: true }), T('c', ['a'], true)];
  const plan = R.planReopen(topics, 'a', { ...R.DEFAULT_CONFIG, reopenPolicy: 'cascade' });
  assert.deepEqual(plan.reopened.sort(), ['a', 'b', 'c']);
  // withdrawing your own submission
  assert.deepEqual(R.planReopen([T('x', [], false, { pending: true })], 'x').reopened, ['x']);
});

test('pending topics do not count as complete progress', () => {
  const p = R.goalProgress([T('a', [], true), T('b', [], false, { pending: true })], []);
  assert.equal(p.percent, 50);
});

/* ------------------------------------------------- estimates, notes, links */
test('topic input: estimate, notes and resource links are validated', () => {
  const ok = R.validateTopicInput({ title: ' Graphs ', estimateMinutes: '90', notes: ' hello ', resources: [{ url: 'https://www.example.com/a' }, { title: 'Docs', url: 'http://x.org' }] });
  assert.equal(ok.title, 'Graphs');
  assert.equal(ok.estimateMinutes, 90);
  assert.equal(ok.notes, 'hello');
  assert.equal(ok.resources[0].title, 'example.com'); // defaults to the host
  assert.equal(R.validateTopicInput({ title: 'x' }).estimateMinutes, 0); // optional
  for (const bad of [-5, 1.5, 40000, 'abc']) throwsCode(() => R.validateTopicInput({ title: 'x', estimateMinutes: bad }), 'VALIDATION');
  throwsCode(() => R.validateTopicInput({ title: 'x', notes: 'n'.repeat(2001) }), 'VALIDATION');
});

test('resource links must be http(s): javascript:, data: and garbage are rejected', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'ftp://x.org/file', 'not a url', '']) {
    throwsCode(() => R.normalizeResources([{ url }]), 'VALIDATION');
  }
  throwsCode(() => R.normalizeResources(Array.from({ length: 11 }, () => ({ url: 'https://a.com' }))), 'VALIDATION');
  assert.deepEqual(R.normalizeResources(null), []);
});

test('session start time is optional but must be HH:MM', () => {
  const run = (time) => R.validateSession({ input: { date: TODAY, minutes: 30, time }, topic: { id: 'a' }, state: { locked: false }, config: R.DEFAULT_CONFIG, today: TODAY });
  assert.equal(run('19:30').time, '19:30');
  assert.equal(run(undefined).time, '');
  for (const bad of ['7pm', '25:00', '19:60', '9:30']) throwsCode(() => run(bad), 'VALIDATION');
});

test('the default per-topic estimate is a validated configuration value', () => {
  assert.equal(R.validateConfig({ defaultTopicMinutes: '120' }).defaultTopicMinutes, 120);
  throwsCode(() => R.validateConfig({ defaultTopicMinutes: 5 }), 'VALIDATION');
});

/* ------------------------------------------------------------- forecast */
const fc = (goal, topics, sessions, config) => F.goalForecast({ goal, topics, sessions, config: config || R.DEFAULT_CONFIG, today: TODAY });
const S = (topicId, date, minutes) => ({ topicId, date, minutes });

test('forecast: on track when the projected finish is before the target', () => {
  // 600 min of work left, 300 min/week pace -> 2 weeks (14 days), target in 30 days
  const topics = [T('a', [], false, { estimateMinutes: 600 })];
  const sessions = [S('a', '2026-11-10', 1200 - 0)]; // 1200 min in last 28 days -> 300/week ... but logged 1200 > 600 estimate
  const f = fc({ targetDate: '2026-12-15' }, [T('a', [], false, { estimateMinutes: 1800 })], sessions);
  // remaining = 1800-1200 = 600, pace = 300/wk -> 14 days -> 29 Nov, target 15 Dec -> 16 days early
  assert.equal(f.remainingMinutes, 600);
  assert.equal(f.paceMinutesPerWeek, 300);
  assert.equal(f.projectedDate, '2026-11-29');
  assert.equal(f.slackDays, 16);
  assert.equal(f.status, 'on_track');
  assert.match(f.headline, /16 days before/);
  void topics;
});

test('forecast: at risk up to two weeks late, behind beyond that, stalled with no recent study, overdue after the date', () => {
  const topics = [T('a', [], false, { estimateMinutes: 1800 })];
  const sessions = [S('a', '2026-11-10', 1200)]; // projected 29 Nov
  assert.equal(fc({ targetDate: '2026-11-20' }, topics, sessions).status, 'at_risk'); // 9 days late
  assert.equal(fc({ targetDate: '2026-11-16' }, topics, sessions).status, 'at_risk'); // 13 days late
  assert.equal(fc({ targetDate: '2026-11-14' }, topics, sessions).status, 'overdue');
  const late = fc({ targetDate: '2026-11-20' }, [T('a', [], false, { estimateMinutes: 6000 })], [S('a', '2026-11-10', 100)]);
  assert.equal(late.status, 'behind');
  assert.ok(late.requiredMinutesPerWeek > late.paceMinutesPerWeek);
  const stalled = fc({ targetDate: '2026-12-31' }, topics, [S('a', '2026-09-01', 600)]);
  assert.equal(stalled.status, 'stalled');
  assert.ok(stalled.requiredMinutesPerWeek > 0);
  assert.equal(fc({ targetDate: '2026-11-15' }, topics, sessions).status, 'overdue'); // target is today
});

test('forecast: done, empty, no target, and topics with no estimate use the average / configured default', () => {
  assert.equal(fc({ targetDate: '2026-12-31' }, [T('a', [], true)], []).status, 'done');
  assert.equal(fc({ targetDate: '2026-12-31' }, [], []).status, 'empty');
  const none = fc({ targetDate: '' }, [T('a', [], false, { estimateMinutes: 300 })], [S('a', '2026-11-10', 100)]);
  assert.equal(none.status, 'no_target');
  assert.ok(none.projectedDate);
  // one known (600) + one unknown -> unknown assumed 600
  const mixed = fc({ targetDate: '2026-12-31' }, [T('a', [], false, { estimateMinutes: 600 }), T('b')], []);
  assert.equal(mixed.remainingMinutes, 1200);
  assert.equal(mixed.assumedTopics, 1);
  // nothing known at all -> configured default
  const dflt = fc({ targetDate: '2026-12-31' }, [T('a'), T('b')], [], { ...R.DEFAULT_CONFIG, defaultTopicMinutes: 90 });
  assert.equal(dflt.remainingMinutes, 180);
});

test('forecast: submitted (pending) topics need no more study time, and old sessions do not inflate the pace', () => {
  const f = fc({ targetDate: '2026-12-31' }, [T('a', [], false, { estimateMinutes: 600, pending: true })], []);
  assert.equal(f.remainingMinutes, 0);
  assert.equal(f.status, 'on_track');
  const old = fc({ targetDate: '2026-12-31' }, [T('a', [], false, { estimateMinutes: 600 })], [S('a', '2026-09-01', 5000)]);
  assert.equal(old.paceMinutesPerWeek, 0);
});

test('forecast: the demo seed produces one on-track, one at-risk and one behind goal', () => {
  const d = SeedData.build(TODAY);
  const topics = d.topics.map((t) => ({ id: t.key, goalId: t.goal, title: t.title, prerequisites: t.prereqs, complete: !!t.completedOn, estimateMinutes: t.estimateMinutes }));
  const sessions = d.sessions.map((s) => ({ topicId: s.topic, goalId: topics.find((t) => t.id === s.topic).goalId, date: s.date, minutes: s.minutes, time: s.time }));
  const status = Object.fromEntries(d.goals.map((g) => [g.key, F.goalForecast({ goal: g, topics: topics.filter((t) => t.goalId === g.key), sessions: sessions.filter((s) => s.goalId === g.key), config: R.DEFAULT_CONFIG, today: TODAY }).status]));
  assert.deepEqual(status, { dsa: 'behind', web: 'on_track', ml: 'at_risk' });
});

/* --------------------------------------------------- habits + smart schedule */
test('habits are learned from weekdays, start times and session length', () => {
  const sessions = [];
  // 6 weeks of Tuesday + Thursday evenings at ~19:30 for 60 minutes
  for (let w = 0; w < 6; w++) for (const off of [-5 - 7 * w, -3 - 7 * w]) sessions.push({ topicId: 'a', goalId: 'g', date: R.addDays(TODAY, off), minutes: 60, time: '19:30' });
  const h = F.habits(sessions, TODAY);
  assert.equal(h.enough, true);
  assert.deepEqual(h.preferredWeekdays, [2, 4]); // Tue, Thu
  assert.equal(h.startWeekday, '19:30');
  assert.equal(h.typicalMinutes, 60);
  assert.equal(h.partOfDay, 'evening');
  assert.equal(F.habits(sessions.slice(0, 2), TODAY).enough, false);
});

test('the smart schedule uses habitual days and times and never schedules a locked topic', () => {
  const topics = [T('a', [], true), T('b', ['a'], false, { goalId: 'g' }), T('c', ['b'])];
  const sessions = [];
  for (let w = 0; w < 6; w++) for (const off of [-5 - 7 * w, -3 - 7 * w]) sessions.push({ topicId: 'b', goalId: 'g', date: R.addDays(TODAY, off), minutes: 60, time: '19:30' });
  const sch = F.suggestSchedule({ topics, sessions, config: R.DEFAULT_CONFIG, today: TODAY });
  assert.equal(sch.basis, 'habits');
  assert.ok(sch.slots.length >= 1);
  for (const s of sch.slots) {
    assert.ok(['Tuesday', 'Thursday'].includes(s.weekday) || sch.slots.length > 2, 'habitual days come first');
    assert.notEqual(s.topicId, 'c'); // locked
    assert.notEqual(s.topicId, 'a'); // complete
    assert.ok(s.minutes >= 5 && s.minutes <= 480);
    assert.match(s.time, /^\d\d:\d\d$/);
  }
  assert.equal(sch.slots.filter((s) => s.weekday === 'Tuesday')[0].time, '19:30');
  assert.deepEqual(F.suggestSchedule({ topics: [T('x', ['y']), T('y', ['x'])], sessions: [], config: R.DEFAULT_CONFIG, today: TODAY }).slots, []);
});

test('with no history the schedule falls back to sensible defaults and says so', () => {
  const sch = F.suggestSchedule({ topics: [T('a')], sessions: [], config: R.DEFAULT_CONFIG, today: TODAY });
  assert.equal(sch.basis, 'defaults');
  assert.ok(sch.slots.length > 0);
});

/* -------------------------------------------------------------- roadmaps */
test('every built-in template yields a valid, loop-free roadmap within the prerequisite limit', () => {
  for (const tpl of F.TEMPLATES) {
    const r = F.sanitizeRoadmap(F.fallbackRoadmap({ subject: tpl.name }), R.DEFAULT_CONFIG);
    assert.ok(r.topics.length >= 8, tpl.name);
    const g = r.topics.map((t) => ({ id: t.key, title: t.title, prerequisites: t.prerequisites }));
    for (const t of g) assert.equal(R.findCyclePath(g, t.id, t.prerequisites), null);
    for (const t of r.topics) assert.ok(t.prerequisites.length <= R.DEFAULT_CONFIG.maxPrerequisitesPerTopic);
  }
  const rust = F.fallbackRoadmap({ subject: 'Learn Rust', level: 'beginner' });
  assert.equal(rust.source, 'template');
  assert.equal(F.fallbackRoadmap({ subject: 'medieval falconry' }).source, 'generic');
  const adv = F.fallbackRoadmap({ subject: 'Rust', level: 'advanced' });
  assert.ok(adv.topics[2].estimateMinutes < rust.topics[2].estimateMinutes); // advanced learners need less time
});

test('sanitizeRoadmap repairs untrusted (AI) output: unknown/self/duplicate edges, loops, limits, order', () => {
  const raw = {
    title: ' My path ',
    topics: [
      { key: 'c', title: 'C', prerequisites: ['b', 'ghost', 'c', 'b'] },
      { key: 'a', title: 'A', prerequisites: ['c'] }, // a -> c -> b -> a would be a loop if b needs a
      { key: 'b', title: 'B', prerequisites: ['a'], hours: 2 },
      { title: '', prerequisites: [] }, // dropped
      { key: 'big', title: 'Big', prerequisites: ['a', 'b', 'c', 'x1', 'x2', 'x3', 'x4'], estimateMinutes: 999999 },
      { key: 'big', title: 'Dup key', prerequisites: [] },
    ],
  };
  const out = F.sanitizeRoadmap(raw, { ...R.DEFAULT_CONFIG, maxPrerequisitesPerTopic: 2 });
  assert.equal(out.title, 'My path');
  const g = out.topics.map((t) => ({ id: t.key, title: t.title, prerequisites: t.prerequisites }));
  for (const t of g) assert.equal(R.findCyclePath(g, t.id, t.prerequisites), null, 'no loops survive');
  for (const t of out.topics) {
    assert.ok(t.prerequisites.length <= 2);
    assert.ok(!t.prerequisites.includes(t.key));
    assert.ok(t.prerequisites.every((p) => out.topics.some((x) => x.key === p)));
    assert.ok(t.estimateMinutes <= 6000);
  }
  // prerequisites always come first
  const pos = new Map(out.topics.map((t, i) => [t.key, i]));
  for (const t of out.topics) for (const p of t.prerequisites) assert.ok(pos.get(p) < pos.get(t.key));
  assert.equal(new Set(out.topics.map((t) => t.key)).size, out.topics.length); // duplicate key renamed
  throwsCode(() => F.sanitizeRoadmap({ topics: [{ title: 'only one' }] }), 'VALIDATION');
  throwsCode(() => F.sanitizeRoadmap(null), 'VALIDATION');
});

/* ----------------------------------------------------------------- quiz */
test('quiz sanitising keeps only well-formed multiple-choice questions', () => {
  const good = (n) => ({ question: `Q${n}?`, options: ['a', 'b', 'c', 'd'], answerIndex: 2, explanation: 'because' });
  const q = F.sanitizeQuiz({ questions: [good(1), good(2), good(3), { question: 'bad', options: ['x'], answerIndex: 0 }, { question: 'bad2', options: ['a', 'b'], answerIndex: 7 }] });
  assert.equal(q.kind, 'mcq');
  assert.equal(q.questions.length, 3);
  throwsCode(() => F.sanitizeQuiz({ questions: [good(1)] }), 'VALIDATION');
  throwsCode(() => F.sanitizeQuiz('nope'), 'VALIDATION');
});

test('the no-AI quiz fallback is honest recall prompts built from the topic', () => {
  const q = F.fallbackQuiz({ title: 'Graphs', notes: 'BFS vs DFS' }, ['Trees']);
  assert.equal(q.kind, 'prompts');
  assert.ok(q.questions.length >= 4);
  assert.ok(q.questions.some((x) => /Trees/.test(x.prompt)));
  assert.ok(q.questions.every((x) => x.prompt && !x.options)); // no invented "correct answers"
});

/* ---------------------------------------------------------------- coach */
function coachCtx() {
  const d = SeedData.build(TODAY);
  const goals = d.goals.map((g) => ({ id: g.key, title: g.title, targetDate: g.targetDate }));
  const topics = d.topics.map((t) => ({ id: t.key, goalId: t.goal, title: t.title, prerequisites: t.prereqs, complete: !!t.completedOn, completedOn: t.completedOn, estimateMinutes: t.estimateMinutes }));
  const sessions = d.sessions.map((s) => ({ topicId: s.topic, goalId: topics.find((t) => t.id === s.topic).goalId, date: s.date, minutes: s.minutes, time: s.time }));
  return F.buildCoachContext({ name: 'Aarav Mehta', goals, topics, sessions, config: R.DEFAULT_CONFIG, today: TODAY });
}
test('the rule-based coach answers from the learner’s real data', () => {
  const ctx = coachCtx();
  assert.ok(ctx.goals.length === 3 && ctx.plan.length > 0);
  assert.match(F.coachFallback('What should I study next?', ctx).replace(/\n/g, ' '), new RegExp(ctx.plan[0].title.replace(/[()&]/g, '.')));
  assert.match(F.coachFallback("What's still locked?", ctx), /needs/);
  assert.match(F.coachFallback('Am I on track for my deadlines?', ctx), /Deadline check/);
  assert.match(F.coachFallback('how was my week', ctx), /studied/);
  assert.match(F.coachFallback('hello', ctx), /Hi Aarav/);
  assert.match(F.coachFallback('I feel tired and unmotivated', ctx), /15 focused minutes/);
  assert.match(F.coachFallback('what is the capital of France', ctx), /built-in coach/); // admits its limits
});

/* ------------------------------------------------------------------ CSV */
test('CSV cells are quoted correctly and neutralise spreadsheet formulas', () => {
  assert.equal(F.csvCell('plain'), 'plain');
  assert.equal(F.csvCell('a,b'), '"a,b"');
  assert.equal(F.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(F.csvCell('line\nbreak'), '"line\nbreak"');
  for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)']) assert.ok(F.csvCell(evil).replace(/^"/, '').startsWith("'"), evil);
  assert.equal(F.csvCell(null), '');
  assert.equal(F.csvCell(45), '45');
});

test('topics and sessions CSV contain the right rows', () => {
  const goals = [{ id: 'g', title: 'Goal, One' }];
  const topics = [T('a', [], true, { completedOn: '2026-11-01', estimateMinutes: 120 }), T('b', ['a'], false, { title: '=cmd' })];
  const sessions = [{ id: 's', goalId: 'g', topicId: 'a', date: '2026-11-01', time: '19:30', minutes: 60, note: 'ok' }];
  const csv = F.topicsCsv({ goals, topics, sessions }).split('\r\n');
  assert.equal(csv[0], 'Goal,Topic,Status,Prerequisites,Estimate (h),Logged (h),Completed on');
  assert.equal(csv[1], '"Goal, One",A,Complete,,2.0,1.0,2026-11-01');
  assert.ok(csv[2].includes("'=cmd"));
  assert.ok(csv[2].includes(',Ready,'));
  const s = F.sessionsCsv({ goals, topics, sessions }).split('\r\n');
  assert.equal(s[0], 'Date,Time,Goal,Topic,Minutes,Note');
  assert.equal(s[1], '2026-11-01,19:30,"Goal, One",A,60,ok');
});

test('the assigned demo goal needs approval-style data: one complete, one pending, dependents locked', () => {
  const a = SeedData.buildAssigned(TODAY);
  assert.equal(a.topics.length, 5);
  const topics = a.topics.map((t) => ({ id: t.key, title: t.title, prerequisites: t.prereqs, complete: t.status === 'complete', pending: t.pending }));
  const st = R.computeStates(topics);
  assert.equal(st.rq.state, 'complete');
  assert.equal(st.lit.state, 'pending');
  assert.equal(st.report.state, 'locked'); // needs ethics + the pending literature review
  for (const s of a.sessions) assert.ok(s.date <= TODAY);
});
