/*
 * End-to-end API tests against a real (in-memory) MongoDB: roles enforced on the server, the unlock rule,
 * re-locking on reopen, and configuration changes altering behaviour without a code change.
 *
 * Uses mongodb-memory-server. Set MONGODB_TEST_URI to run against a MongoDB you already have instead
 * (the database is wiped!). If neither is available the suite is skipped with a message.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const request = require('supertest');

let mongod = null;
let app;
let skipReason = '';
const Rules = require('../shared/rules');

async function connect() {
  if (process.env.MONGODB_TEST_URI) return mongoose.connect(process.env.MONGODB_TEST_URI);
  const { MongoMemoryServer } = require('mongodb-memory-server');
  mongod = await MongoMemoryServer.create();
  return mongoose.connect(mongod.getUri());
}

async function login(email, password) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  assert.equal(res.status, 200, `login failed for ${email}`);
  return agent;
}

const topicByTitle = (payload, title) => payload.topics.find((t) => t.title === title);

test.before(async () => {
  try {
    await connect();
  } catch (e) {
    skipReason = `MongoDB unavailable (${String(e.message).split('\n')[0]})`;
    return;
  }
  process.env.JWT_SECRET = 'test-secret';
  const { seed } = require('../server/seed/seed');
  await seed({ reset: true, log: () => {} });
  app = require('../server/app').createApp();
});

test.after(async () => {
  if (mongoose.connection.readyState) await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

const guarded = (name, fn) =>
  test(name, async (t) => {
    if (skipReason) return t.skip(skipReason);
    await fn(t);
  });

guarded('seed creates exactly three goals, 12 topics and 30 sessions for the demo learner', async () => {
  const learner = await login('learner@demo.com', 'learner123');
  const list = await learner.get('/api/goals');
  assert.equal(list.body.goals.length, 3);
  let topics = 0;
  for (const g of list.body.goals) topics += (await learner.get(`/api/goals/${g.id}`)).body.topics.length;
  assert.equal(topics, 12);
  const dash = await learner.get('/api/dashboard');
  assert.equal(dash.body.totals.sessions, 30);
});

guarded('unauthenticated requests are rejected', async () => {
  assert.equal((await request(app).get('/api/goals')).status, 401);
  assert.equal((await request(app).get('/api/config')).status, 401);
});

guarded('registration can never create a mentor', async () => {
  const res = await request(app).post('/api/auth/register').send({ name: 'Sneaky', email: 'sneaky@x.com', password: 'password123', role: 'mentor' });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'learner');
});

guarded('roles: a learner cannot see another learner; a mentor can view but never edit', async () => {
  const aarav = await login('learner@demo.com', 'learner123');
  const diya = await login('diya@demo.com', 'learner123');
  const mentor = await login('mentor@demo.com', 'mentor123');
  const goals = (await aarav.get('/api/goals')).body.goals;
  const goalId = goals[0].id;

  // another learner: forbidden everywhere
  assert.equal((await diya.get(`/api/goals/${goalId}`)).status, 403);
  assert.equal((await diya.put(`/api/goals/${goalId}`).send({ title: 'Hacked' })).status, 403);
  assert.equal((await diya.delete(`/api/goals/${goalId}`)).status, 403);
  const aaravId = (await aarav.get('/api/auth/me')).body.user.id;
  assert.equal((await diya.get(`/api/dashboard?learnerId=${aaravId}`)).status, 403);

  // mentor: can view any learner's goals…
  const view = await mentor.get(`/api/goals?learnerId=${aaravId}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.goals.length, 3);
  const detail = await mentor.get(`/api/goals/${goalId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.canEdit, false);
  // …but cannot edit them
  assert.equal((await mentor.put(`/api/goals/${goalId}`).send({ title: 'Mentor edit' })).status, 403);
  assert.equal((await mentor.post('/api/goals').send({ title: 'Mentor goal' })).status, 403);
  const topic = detail.body.topics[0];
  assert.equal((await mentor.post(`/api/topics/${topic.id}/reopen`)).status, 403);
  assert.equal((await mentor.post('/api/sessions').send({ topicId: topic.id, date: Rules.todayInTz('Asia/Kolkata'), minutes: 30 })).status, 403);
});

guarded('only the mentor/admin can change configuration', async () => {
  const learner = await login('learner@demo.com', 'learner123');
  const mentor = await login('mentor@demo.com', 'mentor123');
  assert.equal((await learner.put('/api/config').send({ maxSessionMinutes: 60 })).status, 403);
  assert.equal((await learner.get('/api/config')).status, 200); // learners may read the limits
  assert.equal((await mentor.put('/api/config').send({ minSessionMinutes: 100, maxSessionMinutes: 50 })).status, 400);
});

guarded('unlock rule: a locked topic cannot be completed or studied until its prerequisites are complete', async () => {
  const learner = await login('learner@demo.com', 'learner123');
  const goals = (await learner.get('/api/goals')).body.goals;
  const dsa = goals.find((g) => g.title.includes('Data Structures'));
  const detail = (await learner.get(`/api/goals/${dsa.id}`)).body;
  const trees = topicByTitle(detail, 'Trees & Graphs');
  const lists = topicByTitle(detail, 'Linked Lists & Stacks');
  assert.equal(trees.state, 'locked');
  assert.deepEqual(trees.missing.map((m) => m.title), ['Linked Lists & Stacks']);

  const blocked = await learner.post(`/api/topics/${trees.id}/complete`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'LOCKED');
  assert.equal(blocked.body.details.missing[0].title, 'Linked Lists & Stacks');
  const today = Rules.todayInTz('Asia/Kolkata');
  assert.equal((await learner.post('/api/sessions').send({ topicId: trees.id, date: today, minutes: 30 })).status, 409);

  // finish the prerequisite → Trees unlocks
  const done = await learner.post(`/api/topics/${lists.id}/complete`);
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.unlocked.map((u) => u.title), ['Trees & Graphs']);
  assert.equal(topicByTitle(done.body, 'Trees & Graphs').state, 'available');
  assert.equal((await learner.post(`/api/topics/${trees.id}/complete`)).status, 200);
});

guarded('a reopened topic re-locks its dependents (cascade), and the block policy refuses', async () => {
  const learner = await login('learner@demo.com', 'learner123');
  const mentor = await login('mentor@demo.com', 'mentor123');
  const dsa = (await learner.get('/api/goals')).body.goals.find((g) => g.title.includes('Data Structures'));
  let detail = (await learner.get(`/api/goals/${dsa.id}`)).body;
  // from the previous test: Linked Lists and Trees are complete; Dynamic Programming is available
  const arrays = topicByTitle(detail, 'Arrays & Strings');
  assert.equal(topicByTitle(detail, 'Trees & Graphs').state, 'complete');

  // block policy first
  await mentor.put('/api/config').send({ reopenPolicy: 'block' });
  const refused = await learner.post(`/api/topics/${arrays.id}/reopen`);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'CONFLICT');

  // cascade policy
  await mentor.put('/api/config').send({ reopenPolicy: 'cascade' });
  const res = await learner.post(`/api/topics/${arrays.id}/reopen`);
  assert.equal(res.status, 200);
  const s = (title) => topicByTitle(res.body, title).state;
  assert.equal(s('Big-O & Complexity'), 'complete');
  assert.notEqual(s('Arrays & Strings'), 'complete');
  assert.equal(s('Linked Lists & Stacks'), 'locked');
  assert.equal(s('Trees & Graphs'), 'locked');
  assert.equal(s('Dynamic Programming'), 'locked');
  assert.ok(res.body.relocked.length >= 3);
});

guarded('loops and self-references are rejected when editing prerequisites', async () => {
  const learner = await login('learner@demo.com', 'learner123');
  const web = (await learner.get('/api/goals')).body.goals.find((g) => g.title.includes('Web'));
  const detail = (await learner.get(`/api/goals/${web.id}`)).body;
  const node = topicByTitle(detail, 'Node & Express');
  const mongo = topicByTitle(detail, 'MongoDB & Data Modelling');
  const self = await learner.put(`/api/topics/${node.id}`).send({ prerequisites: [node.id] });
  assert.equal(self.status, 400);
  assert.equal(self.body.details.reason, 'self');
  // Mongo needs Node; making Node need Mongo closes a loop
  const loop = await learner.put(`/api/topics/${node.id}`).send({ prerequisites: [mongo.id] });
  assert.equal(loop.status, 400);
  assert.equal(loop.body.details.reason, 'cycle');
  assert.match(loop.body.error, /loop/);
});

guarded('configured session limits change behaviour with no code change', async () => {
  const learner = await login('learner@demo.com', 'learner123');
  const mentor = await login('mentor@demo.com', 'mentor123');
  const web = (await learner.get('/api/goals')).body.goals.find((g) => g.title.includes('Web'));
  const mongo = topicByTitle((await learner.get(`/api/goals/${web.id}`)).body, 'MongoDB & Data Modelling');
  const today = Rules.todayInTz('Asia/Kolkata');
  const log = (minutes, date = today) => learner.post('/api/sessions').send({ topicId: mongo.id, date, minutes, note: 'test' });

  assert.equal((await log(4)).status, 400);
  assert.equal((await log(5)).status, 201);
  assert.equal((await log(480)).status, 201);
  assert.equal((await log(481)).status, 400);

  await mentor.put('/api/config').send({ minSessionMinutes: 20, maxSessionMinutes: 90 });
  assert.equal((await log(10)).status, 400);
  assert.equal((await log(91)).status, 400);
  assert.equal((await log(60)).status, 201);
  assert.equal((await learner.get('/api/config')).body.config.maxSessionMinutes, 90);

  await mentor.put('/api/config').send({ minSessionMinutes: 5, maxSessionMinutes: 480 });
  assert.equal((await log(10)).status, 201);

  // never in the future
  const future = Rules.addDays(today, 1);
  const bad = await log(30, future);
  assert.equal(bad.status, 400);
  assert.ok(bad.body.details.fields.date);
});

guarded('max prerequisites per topic is read from configuration', async () => {
  const learner = await login('learner@demo.com', 'learner123');
  const mentor = await login('mentor@demo.com', 'mentor123');
  const ml = (await learner.get('/api/goals')).body.goals.find((g) => g.title.includes('Machine'));
  const mk = (title, prerequisites = []) => learner.post(`/api/goals/${ml.id}/topics`).send({ title, prerequisites });
  let detail = (await learner.get(`/api/goals/${ml.id}`)).body;
  const ids = detail.topics.map((t) => t.id);

  await mentor.put('/api/config').send({ maxPrerequisitesPerTopic: 2 });
  assert.equal((await mk('Too many', ids)).status, 400);
  assert.equal((await mk('Two is fine', ids.slice(0, 2))).status, 201);
  await mentor.put('/api/config').send({ maxPrerequisitesPerTopic: 5 });
  assert.equal((await mk('Three now fine', ids.slice(0, 3))).status, 201);
});

guarded('the weekly review and plan endpoint works and never suggests locked topics', async () => {
  const learner = await login('learner@demo.com', 'learner123');
  const res = await learner.get('/api/insights');
  assert.equal(res.status, 200);
  assert.ok(res.body.narrative.text.length > 20);
  assert.ok(['engine', 'gemini'].includes(res.body.narrative.source));
  const detailStates = {};
  for (const g of (await learner.get('/api/goals')).body.goals)
    for (const t of (await learner.get(`/api/goals/${g.id}`)).body.topics) detailStates[t.id] = t.state;
  for (const item of res.body.plan.items) assert.notEqual(detailStates[item.topicId], 'locked');
});

/* ===================================================================================================
 * v2 features: people & cohorts, assigned goals + approvals, share links, notes/links, estimates +
 * forecast, export, AI fallbacks (no GEMINI_API_KEY in tests), smart schedule, roadmap import.
 * =================================================================================================== */
const agents = new Map();
async function as(email, password) {
  if (!agents.has(email)) agents.set(email, await login(email, password));
  return agents.get(email);
}
const mentorA = () => as('mentor@demo.com', 'mentor123');
const aaravA = () => as('learner@demo.com', 'learner123');
const diyaA = () => as('diya@demo.com', 'learner123');
const learnerId = async (agent) => (await agent.get('/api/auth/me')).body.user.id;

guarded('admin: only a mentor can manage people; a generated temporary password works once handed over', async () => {
  const mentor = await mentorA();
  const aarav = await aaravA();
  assert.equal((await aarav.get('/api/admin/users')).status, 403);
  assert.equal((await request(app).get('/api/admin/users')).status, 401);
  const bad = await mentor.post('/api/admin/users').send({ name: 'X', email: 'nope', role: 'admin' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.details.fields.email && bad.body.details.fields.role);

  const made = await mentor.post('/api/admin/users').send({ name: 'Second Mentor', email: 'mentor2@demo.com', role: 'mentor' });
  assert.equal(made.status, 201);
  assert.ok(made.body.tempPassword && made.body.tempPassword.length >= 8);
  assert.equal((await mentor.post('/api/admin/users').send({ name: 'Dup', email: 'MENTOR2@demo.com', role: 'learner' })).status, 400);
  const m2 = await login('mentor2@demo.com', made.body.tempPassword);
  assert.equal((await m2.get('/api/admin/users')).status, 200); // a freshly created mentor is a real mentor

  // safeguards
  const meId = await learnerId(m2);
  assert.equal((await m2.put(`/api/admin/users/${meId}`).send({ role: 'learner' })).status, 409);
  assert.equal((await m2.put(`/api/admin/users/${meId}`).send({ active: false })).status, 409);

  // reset password, deactivate, reactivate
  const reset = await mentor.post(`/api/admin/users/${meId}/reset-password`);
  assert.equal(reset.status, 200);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'mentor2@demo.com', password: made.body.tempPassword })).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'mentor2@demo.com', password: reset.body.tempPassword })).status, 200);
  assert.equal((await mentor.put(`/api/admin/users/${meId}`).send({ active: false })).status, 200);
  assert.equal((await m2.get('/api/auth/me')).status, 401); // existing session is cut off
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'mentor2@demo.com', password: reset.body.tempPassword })).status, 401);
  assert.equal((await mentor.put(`/api/admin/users/${meId}`).send({ active: true })).status, 200);
});

guarded('change password requires the current password', async () => {
  const mentor = await mentorA();
  const made = await mentor.post('/api/admin/users').send({ name: 'Pat Learner', email: 'pat@demo.com', role: 'learner', password: 'first-pass-1' });
  assert.equal(made.body.tempPassword, null);
  const pat = await login('pat@demo.com', 'first-pass-1');
  assert.equal((await pat.post('/api/auth/change-password').send({ currentPassword: 'wrong', newPassword: 'second-pass-2' })).status, 400);
  assert.equal((await pat.post('/api/auth/change-password').send({ currentPassword: 'first-pass-1', newPassword: 'short' })).status, 400);
  assert.equal((await pat.post('/api/auth/change-password').send({ currentPassword: 'first-pass-1', newPassword: 'second-pass-2' })).status, 200);
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'pat@demo.com', password: 'second-pass-2' })).status, 200);
});

guarded('cohorts: CRUD with stats, learners only, mentor only', async () => {
  const mentor = await mentorA();
  const aarav = await aaravA();
  const diya = await diyaA();
  assert.equal((await aarav.get('/api/admin/cohorts')).status, 403);
  const seeded = (await mentor.get('/api/admin/cohorts')).body.cohorts;
  assert.equal(seeded[0].stats.learners, 2);
  assert.equal(seeded[0].stats.pendingApprovals >= 1, true); // Diya's submitted topic

  const mentorId = await learnerId(mentor);
  assert.equal((await mentor.post('/api/admin/cohorts').send({ name: 'Bad', memberIds: [mentorId] })).status, 400); // learners only
  const diyaId = await learnerId(diya);
  const created = await mentor.post('/api/admin/cohorts').send({ name: 'Spring batch', memberIds: [diyaId] });
  assert.equal(created.status, 201);
  const c = created.body.cohorts.find((x) => x.name === 'Spring batch');
  assert.equal(c.stats.learners, 1);
  assert.equal((await mentor.post('/api/admin/cohorts').send({ name: 'Spring batch', memberIds: [] })).status, 400); // unique name
  const aaravId = await learnerId(aarav);
  const upd = await mentor.put(`/api/admin/cohorts/${c.id}`).send({ memberIds: [diyaId, aaravId] });
  assert.equal(upd.body.cohorts.find((x) => x.id === c.id).stats.learners, 2);
  assert.equal((await mentor.delete(`/api/admin/cohorts/${c.id}`)).status, 200);
  assert.equal((await mentor.delete(`/api/admin/cohorts/${c.id}`)).status, 404);
});

guarded('assigned goal + approval workflow: mentor structures, learner studies and submits, mentor approves or sends back', async () => {
  const mentor = await mentorA();
  const diya = await diyaA();
  const diyaId = await learnerId(diya);
  const cohortLess = await mentor.post('/api/admin/assign').send({ goal: { title: 'Intro to Stats' }, topics: [{ title: 'x' }, { title: 'y' }], learnerIds: [] });
  assert.equal(cohortLess.status, 400); // needs somebody to assign to
  assert.equal((await diya.post('/api/admin/assign').send({})).status, 403);

  const res = await mentor.post('/api/admin/assign').send({
    goal: { title: 'Intro to Stats', description: 'Mentor-assigned', targetDate: '' },
    topics: [{ key: 'a', title: 'Descriptive stats', hours: 2 }, { key: 'b', title: 'Inference', prerequisites: ['a'], hours: 3 }],
    learnerIds: [diyaId], requireApproval: true,
  });
  assert.equal(res.status, 201);
  const list = (await diya.get('/api/goals')).body.goals;
  const goal = list.find((g) => g.title === 'Intro to Stats');
  assert.ok(goal && goal.assigned && goal.requireApproval && goal.assignedByName);
  let g = (await diya.get(`/api/goals/${goal.id}`)).body;
  assert.equal(g.canEdit, true);
  assert.equal(g.canStructure, false);
  assert.equal((await diya.post(`/api/goals/${goal.id}/topics`).send({ title: 'Sneaky' })).status, 403); // learner can't restructure
  assert.equal((await diya.put(`/api/goals/${goal.id}`).send({ title: 'Mine now' })).status, 403);
  assert.equal((await diya.delete(`/api/goals/${goal.id}`)).status, 403);
  const A = topicByTitle(g, 'Descriptive stats');
  const B = topicByTitle(g, 'Inference');
  assert.equal(A.estimateMinutes, 120);
  assert.equal(B.state, 'locked');
  assert.equal((await diya.put(`/api/topics/${A.id}`).send({ title: 'Renamed' })).status, 403);

  // learner can still study
  const today = Rules.todayInTz('Asia/Kolkata');
  assert.equal((await diya.post('/api/sessions').send({ topicId: A.id, date: today, minutes: 30, time: '18:00' })).status, 201);
  // completing submits for approval, and the dependent stays locked
  const sub = await diya.post(`/api/topics/${A.id}/complete`);
  assert.equal(sub.status, 200);
  assert.equal(sub.body.submitted, true);
  assert.equal(topicByTitle(sub.body, 'Descriptive stats').state, 'pending');
  assert.equal(topicByTitle(sub.body, 'Inference').state, 'locked');
  assert.equal((await diya.post(`/api/sessions`).send({ topicId: B.id, date: today, minutes: 20 })).status, 409); // still locked
  assert.equal((await diya.post(`/api/topics/${A.id}/approve`)).status, 403); // learner can't approve herself
  assert.equal((await diya.post(`/api/topics/${A.id}/reject`).send({ comment: 'no' })).status, 403);

  // inbox shows it; mentor approves
  const inbox = (await mentor.get('/api/admin/approvals')).body.approvals;
  assert.ok(inbox.some((x) => x.topicId === A.id && x.learnerName.startsWith('Diya')));
  const ok = await mentor.post(`/api/topics/${A.id}/approve`);
  assert.equal(ok.status, 200);
  assert.equal(topicByTitle(ok.body, 'Descriptive stats').state, 'complete');
  assert.equal(topicByTitle(ok.body, 'Inference').locked, false); // now unlocked
  assert.equal(ok.body.canApprove, true);
  assert.equal((await mentor.post(`/api/topics/${A.id}/approve`)).status, 409); // nothing left to approve

  // submit B, mentor sends it back with feedback
  assert.equal((await diya.post(`/api/topics/${B.id}/complete`)).body.submitted, true);
  assert.equal((await mentor.post(`/api/topics/${B.id}/reject`).send({})).status, 400); // a reason is required
  const back = await mentor.post(`/api/topics/${B.id}/reject`).send({ comment: 'Add a worked example of a t-test' });
  const Bn = topicByTitle(back.body, 'Inference');
  assert.equal(Bn.state === 'pending', false);
  assert.equal(Bn.review.status, 'changes');
  assert.match(Bn.review.comment, /t-test/);
  assert.equal((await mentor.post(`/api/topics/${B.id}/reject`).send({ comment: 'again' })).status, 409);

  // mentor (who structures assigned goals) can edit; and reopening A withdraws nothing wrongly
  assert.equal((await mentor.put(`/api/topics/${B.id}`).send({ title: 'Inference & testing', estimateMinutes: 240 })).status, 200);
  assert.equal((await mentor.post(`/api/goals/${goal.id}/topics`).send({ title: 'Regression', prerequisites: [B.id] })).status, 201);

  // seeded approval from the demo data is waiting too
  const seeded = (await mentor.get('/api/admin/approvals')).body.approvals.find((x) => x.title === 'Literature review');
  assert.ok(seeded);
  assert.equal((await mentor.get('/api/admin/assigned')).body.assigned.some((x) => x.title === 'Intro to Stats'), true);
});

guarded('a learner who reopens a prerequisite re-locks dependants, including ones that were submitted', async () => {
  const diya = await diyaA();
  const goals = (await diya.get('/api/goals')).body.goals;
  const goal = goals.find((g) => g.title.startsWith('Research Methods'));
  const g = (await diya.get(`/api/goals/${goal.id}`)).body;
  const rq = topicByTitle(g, 'Research questions & hypotheses');
  assert.equal(rq.state, 'complete');
  const lit = topicByTitle(g, 'Literature review');
  assert.equal(lit.state, 'pending');
  const out = await diya.post(`/api/topics/${rq.id}/reopen`);
  assert.equal(out.status, 200);
  assert.equal(topicByTitle(out.body, 'Research questions & hypotheses').state === 'complete', false);
  // withdrawing your own submission is allowed
  const w = await diya.post(`/api/topics/${lit.id}/reopen`);
  assert.equal(w.status, 200);
  assert.equal(topicByTitle(w.body, 'Literature review').state === 'pending', false);
});

guarded('share link: public read-only snapshot with no private data; revocable and expiring; owner-only', async () => {
  const aarav = await aaravA();
  const mentor = await mentorA();
  const web = (await aarav.get('/api/goals')).body.goals.find((g) => g.title.includes('Full-Stack'));
  assert.equal((await mentor.post(`/api/goals/${web.id}/shares`).send({ days: 7 })).status, 403);
  assert.equal((await aarav.post(`/api/goals/${web.id}/shares`).send({ days: 5 })).status, 400);
  const made = await aarav.post(`/api/goals/${web.id}/shares`).send({ days: 7 });
  assert.equal(made.status, 201);
  const share = made.body.shares[0];
  assert.ok(share.token.length >= 30 && share.expiresAt);

  const pub = await request(app).get(`/api/share/${share.token}`); // no cookie at all
  assert.equal(pub.status, 200);
  assert.equal(pub.body.readOnly, true);
  assert.equal(pub.body.learnerFirstName, 'Aarav');
  assert.ok(pub.body.topics.length >= 4 && pub.body.forecast && pub.body.progress);
  const raw = JSON.stringify(pub.body);
  for (const secret of ['learner@demo.com', 'Embed when data', 'mongodb.com/docs', 'Great pace on Node', 'Population and lean', 'Mehta', 'notes', 'resources', 'passwordHash']) assert.equal(raw.includes(secret), false, `leaked: ${secret}`);
  // the public endpoint is read-only
  assert.equal((await request(app).post(`/api/share/${share.token}`).send({})).status, 405);
  assert.equal((await request(app).get('/api/share/not-a-real-token-xxxxxxxxxxxx')).status, 404);

  // another learner can't revoke it; the owner can; revoked links die immediately
  assert.equal((await (await diyaA()).delete(`/api/shares/${share.id}`)).status, 403);
  assert.equal((await aarav.delete(`/api/shares/${share.id}`)).status, 200);
  assert.equal((await request(app).get(`/api/share/${share.token}`)).status, 404);

  // expired links are gone too
  const again = (await aarav.post(`/api/goals/${web.id}/shares`).send({ days: 30 })).body.shares[0];
  const { Share } = require('../server/models');
  await Share.updateOne({ token: again.token }, { expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await request(app).get(`/api/share/${again.token}`)).status, 404);
  // the seeded demo link still works
  const seeded = await Share.findOne({ expiresAt: null }).lean();
  assert.equal((await request(app).get(`/api/share/${seeded.token}`)).status, 200);
});

guarded('notes and resource links: validated, learner-owned, javascript: links rejected', async () => {
  const aarav = await aaravA();
  const mentor = await mentorA();
  const web = (await aarav.get('/api/goals')).body.goals.find((g) => g.title.includes('Full-Stack'));
  const g = (await aarav.get(`/api/goals/${web.id}`)).body;
  const mongo = topicByTitle(g, 'MongoDB & Data Modelling');
  assert.equal(mongo.resources.length, 1);
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.org', 'junk']) {
    assert.equal((await aarav.put(`/api/topics/${mongo.id}/notes`).send({ notes: 'n', resources: [{ url }] })).status, 400, url);
  }
  assert.equal((await aarav.put(`/api/topics/${mongo.id}/notes`).send({ notes: 'x'.repeat(2001) })).status, 400);
  const ok = await aarav.put(`/api/topics/${mongo.id}/notes`).send({ notes: 'Remember compound indexes', resources: [{ title: 'Docs', url: 'https://www.mongodb.com/docs/' }, { url: 'https://example.org/a' }] });
  assert.equal(ok.status, 200);
  const t = topicByTitle(ok.body, 'MongoDB & Data Modelling');
  assert.equal(t.notes, 'Remember compound indexes');
  assert.equal(t.resources[1].title, 'example.org');
  assert.equal((await mentor.put(`/api/topics/${mongo.id}/notes`).send({ notes: 'hax' })).status, 403);
});

guarded('estimates drive the deadline forecast; unfinished goals show a status and warnings reach the dashboard', async () => {
  const aarav = await aaravA();
  const goals = (await aarav.get('/api/goals')).body.goals;
  const status = Object.fromEntries(goals.map((g) => [g.title.split(' ')[0], g.forecast.status]));
  // (earlier tests in this file added topics to the ML goal, so it may have slipped from at_risk to behind)
  assert.equal(status.Master, 'behind');
  assert.equal(status['Full-Stack'], 'on_track');
  assert.ok(['at_risk', 'behind'].includes(status.Applied));
  const dash = (await aarav.get('/api/dashboard')).body;
  assert.equal(dash.alerts.length, 2); // DSA + ML
  assert.ok(dash.alerts.every((a) => a.headline));
  const ml = goals.find((g) => g.title.startsWith('Applied'));
  const detail = (await aarav.get(`/api/goals/${ml.id}`)).body;
  const before = detail.forecast.remainingMinutes;
  const evalT = topicByTitle(detail, 'Model Evaluation');
  const upd = await aarav.put(`/api/topics/${evalT.id}`).send({ estimateMinutes: 36000 });
  assert.equal(upd.status, 200);
  assert.ok(upd.body.forecast.remainingMinutes > before);
  assert.equal((await aarav.put(`/api/topics/${evalT.id}`).send({ estimateMinutes: -1 })).status, 400);
  await aarav.put(`/api/topics/${evalT.id}`).send({ estimateMinutes: 360 });
});

guarded('CSV export: correct content, formula injection neutralised, access follows the role rules', async () => {
  const aarav = await aaravA();
  const mentor = await mentorA();
  const diya = await diyaA();
  const web = (await aarav.get('/api/goals')).body.goals.find((g) => g.title.includes('Full-Stack'));
  assert.equal((await aarav.post(`/api/goals/${web.id}/topics`).send({ title: '=HYPERLINK("http://evil")' })).status, 201);
  const res = await aarav.get('/api/export/progress.csv?kind=topics').buffer(true).parse((r, cb) => { let d = ''; r.setEncoding('utf8'); r.on('data', (c) => (d += c)); r.on('end', () => cb(null, d)); });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.headers['content-disposition'], /attachment/);
  const csv = res.body;
  assert.ok(csv.startsWith('﻿Goal,Topic,Status'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.equal(/(^|,)"?=HYPERLINK/m.test(csv), false);
  const sess = await aarav.get('/api/export/progress.csv?kind=sessions').buffer(true).parse((r, cb) => { let d = ''; r.setEncoding('utf8'); r.on('data', (c) => (d += c)); r.on('end', () => cb(null, d)); });
  const dashTotal = (await aarav.get('/api/dashboard')).body.totals.sessions;
  assert.equal(sess.body.trim().split('\r\n').length, dashTotal + 1); // header + every session
  const aaravId = await learnerId(aarav);
  assert.equal((await diya.get(`/api/export/progress.csv?learnerId=${aaravId}`)).status, 403);
  assert.equal((await mentor.get(`/api/export/progress.csv?learnerId=${aaravId}`)).status, 200);
  assert.equal((await mentor.get('/api/export/progress.csv')).status, 400); // mentor must say whose
  assert.equal((await request(app).get('/api/export/progress.csv')).status, 401);
});

guarded('PDF export returns a real PDF and respects access rules', async () => {
  const aarav = await aaravA();
  const diya = await diyaA();
  const bin = (r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); };
  const res = await aarav.get('/api/export/progress.pdf').buffer(true).parse(bin);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/pdf/);
  assert.equal(res.body.slice(0, 5).toString(), '%PDF-');
  assert.ok(res.body.length > 1500);
  assert.equal((await diya.get(`/api/export/progress.pdf?learnerId=${await learnerId(aarav)}`)).status, 403);
});

guarded('AI features fall back to built-in logic (and say so) when no API key is configured', async () => {
  const aarav = await aaravA();
  const mentor = await mentorA();
  assert.equal(process.env.GEMINI_API_KEY, undefined);
  const road = await aarav.post('/api/ai/roadmap').send({ subject: 'Learn Rust', level: 'beginner' });
  assert.equal(road.status, 200);
  assert.equal(road.body.source, 'template');
  assert.ok(road.body.roadmap.topics.length >= 8);
  assert.equal((await aarav.post('/api/ai/roadmap').send({ subject: '' })).status, 400);
  assert.equal((await request(app).post('/api/ai/roadmap').send({ subject: 'Rust' })).status, 401);

  const web = (await aarav.get('/api/goals')).body.goals.find((g) => g.title.includes('Full-Stack'));
  const mongo = topicByTitle((await aarav.get(`/api/goals/${web.id}`)).body, 'MongoDB & Data Modelling');
  const quiz = await aarav.post(`/api/topics/${mongo.id}/quiz`);
  assert.equal(quiz.status, 200);
  assert.equal(quiz.body.source, 'builtin');
  assert.equal(quiz.body.quiz.kind, 'prompts');
  assert.equal((await (await diyaA()).post(`/api/topics/${mongo.id}/quiz`)).status, 403); // someone else's topic
  assert.equal((await aarav.post(`/api/topics/${mongo.id}/quiz/attempt`).send({ score: 3, total: 5 })).status, 201);
  assert.equal((await aarav.post(`/api/topics/${mongo.id}/quiz/attempt`).send({ score: 9, total: 5 })).status, 400);

  const coach = await aarav.post('/api/coach').send({ message: 'What should I study next?', history: [] });
  assert.equal(coach.status, 200);
  assert.equal(coach.body.source, 'builtin');
  assert.ok(coach.body.reply.length > 20 && coach.body.chips.length > 0);
  assert.equal((await aarav.post('/api/coach').send({ message: '   ' })).status, 400);
  assert.equal((await mentor.post('/api/coach').send({ message: 'hi' })).status, 400); // coach is for learners
});

guarded('smart schedule: built from study habits and never contains a locked topic', async () => {
  const aarav = await aaravA();
  const res = (await aarav.get('/api/insights')).body;
  assert.equal(res.schedule.basis, 'habits');
  assert.ok(res.schedule.slots.length > 0);
  const states = {};
  for (const g of (await aarav.get('/api/goals')).body.goals) for (const t of (await aarav.get(`/api/goals/${g.id}`)).body.topics) states[t.id] = t.state;
  for (const s of res.schedule.slots) assert.ok(['available', 'in_progress'].includes(states[s.topicId]), `${s.title} is ${states[s.topicId]}`);
  assert.equal(res.schedule.habits.startWeekday, '19:30');
});

guarded('roadmap import: a learner creates a goal from a (possibly broken) roadmap and loops are repaired', async () => {
  const aarav = await aaravA();
  const mentor = await mentorA();
  assert.equal((await mentor.post('/api/goals/import').send({})).status, 403);
  const bad = await aarav.post('/api/goals/import').send({ goal: { title: 'Rust' }, topics: [{ title: 'only one' }] });
  assert.equal(bad.status, 400);
  const res = await aarav.post('/api/goals/import').send({
    goal: { title: 'Learn Rust', color: 'rose' },
    topics: [
      { key: 'a', title: 'Basics', prerequisites: ['c'], hours: 4 },
      { key: 'b', title: 'Ownership', prerequisites: ['a'], hours: 6 },
      { key: 'c', title: 'Traits', prerequisites: ['b'], hours: 5 }, // closes a loop
    ],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.topics.length, 3);
  assert.equal(res.body.canStructure, true);
  assert.equal(res.body.assigned, undefined);
  const byId = new Map(res.body.topics.map((t) => [t.id, t]));
  for (const t of res.body.topics) assert.equal(Rules.findCyclePath(res.body.topics, t.id, t.prerequisites), null);
  assert.ok(res.body.topics.some((t) => t.state === 'available')); // there is always somewhere to start
  void byId;
});
