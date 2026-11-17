/*
 * Seeds the database: 1 mentor, 2 learners, and for the first learner exactly what the brief asks for —
 * three goals, 12 topics with prerequisites and 30 study sessions spread over six weeks.
 *
 *   npm run seed          (adds the demo data if the demo users don't exist yet)
 *   npm run seed:reset    (wipes the collections first)
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');
const crypto = require('crypto');
const { User, Goal, Topic, Session, Setting, Feedback, Cohort, Share, QuizAttempt } = require('../models');
const Rules = require('../../shared/rules');
const SeedData = require('../../shared/seed-data');

async function seed({ reset = false, log = console.log } = {}) {
  if (reset) {
    await Promise.all([User, Goal, Topic, Session, Setting, Feedback, Cohort, Share, QuizAttempt].map((m) => m.deleteMany({})));
    log('Collections cleared');
  }
  if (await User.findOne({ email: 'learner@demo.com' })) {
    log('Demo data already present — use --reset to rebuild it');
    return;
  }
  const hash = (p) => bcrypt.hash(p, 10);
  const [mentor, aarav] = await User.create([
    { name: 'Dr. Kavya Iyer', email: 'mentor@demo.com', passwordHash: await hash('mentor123'), role: 'mentor' },
    { name: 'Aarav Mehta', email: 'learner@demo.com', passwordHash: await hash('learner123'), role: 'learner' },
  ]);
  const diya = await User.create({ name: 'Diya Nair', email: 'diya@demo.com', passwordHash: await hash('learner123'), role: 'learner' });
  await Setting.updateOne({ key: 'app' }, { values: Rules.DEFAULT_CONFIG }, { upsert: true });

  const today = Rules.todayInTz(config.tz);
  const data = SeedData.build(today);

  const goalDocs = {};
  for (const g of data.goals) {
    goalDocs[g.key] = await Goal.create({ owner: aarav._id, title: g.title, description: g.description, color: g.color, targetDate: g.targetDate });
  }
  const topicDocs = {};
  let order = 0;
  for (const t of data.topics) {
    // prerequisites are listed before the topics that need them, so they already exist
    topicDocs[t.key] = await Topic.create({
      goal: goalDocs[t.goal]._id,
      owner: aarav._id,
      title: t.title,
      description: t.description,
      prerequisites: t.prereqs.map((k) => topicDocs[k]._id),
      complete: !!t.completedOn,
      completedOn: t.completedOn,
      estimateMinutes: t.estimateMinutes,
      notes: t.notes,
      resources: t.resources,
      order: order++,
    });
  }
  for (const s of data.sessions) {
    const topic = topicDocs[s.topic];
    await Session.create({ owner: aarav._id, goal: topic.goal, topic: topic._id, date: s.date, time: s.time, minutes: s.minutes, note: s.note });
  }
  await Feedback.create({
    goal: goalDocs.web._id,
    author: mentor._id,
    authorName: mentor.name,
    text: 'Great pace on Node. Finish the indexing exercises before touching Auth — it will make the security work much easier.',
  });
  // A goal the mentor assigned to Diya (needs approval): one topic is awaiting review.
  const asg = SeedData.buildAssigned(today);
  const ag = await Goal.create({ owner: diya._id, ...asg.goal, assignedBy: mentor._id, assignedByName: mentor.name, requireApproval: true });
  const at = {};
  let ao = 0;
  for (const t of asg.topics) {
    at[t.key] = await Topic.create({ goal: ag._id, owner: diya._id, title: t.title, description: t.description, prerequisites: t.prereqs.map((k) => at[k]._id), complete: t.status === 'complete', completedOn: t.completedOn, pending: t.pending, pendingAt: t.pending ? new Date() : null, estimateMinutes: t.estimateMinutes, order: ao++ });
  }
  for (const s of asg.sessions) await Session.create({ owner: diya._id, goal: ag._id, topic: at[s.topic]._id, date: s.date, time: s.time, minutes: s.minutes, note: s.note });
  await Cohort.create({ name: 'Autumn 2026 batch', description: 'Demo cohort', members: [aarav._id, diya._id] });
  const token = crypto.randomBytes(24).toString('base64url');
  await Share.create({ token, goal: goalDocs.web._id, owner: aarav._id, createdBy: aarav._id, expiresAt: null });
  log(`Demo share link → /#/s/${token}`);
  log(`Seeded: ${data.goals.length} goals, ${data.topics.length} topics, ${data.sessions.length} sessions`);
  log('Sign in → mentor@demo.com / mentor123   |   learner@demo.com / learner123   |   diya@demo.com / learner123');
}

module.exports = { seed };

if (require.main === module) {
  mongoose
    .connect(config.mongoUri)
    .then(() => seed({ reset: process.argv.includes('--reset') }))
    .then(() => mongoose.disconnect())
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
