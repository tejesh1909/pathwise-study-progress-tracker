/* Loading helpers + conversions between Mongoose documents and the plain shapes used by shared/rules.js. */
const { Setting, Goal, Topic, Session } = require('../models');
const Rules = require('../../shared/rules');
const { RuleError } = Rules;

/** Configuration is read from the database on every request, so changing a value changes behaviour immediately. */
async function getConfig() {
  const doc = await Setting.findOne({ key: 'app' }).lean();
  return Object.assign({}, Rules.DEFAULT_CONFIG, doc ? doc.values : {});
}

async function saveConfig(input) {
  const current = await getConfig();
  const next = Rules.validateConfig(input, current);
  await Setting.findOneAndUpdate({ key: 'app' }, { values: next }, { upsert: true, new: true });
  return next;
}

const plainTopic = (t) => ({
  id: String(t._id),
  goalId: String(t.goal),
  ownerId: String(t.owner),
  title: t.title,
  description: t.description || '',
  prerequisites: (t.prerequisites || []).map(String),
  complete: !!t.complete,
  completedOn: t.completedOn || '',
  estimateMinutes: t.estimateMinutes || 0,
  notes: t.notes || '',
  resources: (t.resources || []).map((r) => ({ title: r.title, url: r.url })),
  pending: !!t.pending,
  review: t.review ? { status: t.review.status, comment: t.review.comment || '', byName: t.review.byName || '', at: t.review.at } : null,
  order: t.order || 0,
});

const plainSession = (s) => ({
  id: String(s._id),
  ownerId: String(s.owner),
  goalId: String(s.goal),
  topicId: String(s.topic),
  date: s.date,
  time: s.time || '',
  minutes: s.minutes,
  note: s.note || '',
});

const plainGoal = (g) => ({
  id: String(g._id),
  ownerId: String(g.owner),
  title: g.title,
  description: g.description || '',
  color: g.color || 'violet',
  targetDate: g.targetDate || '',
  assigned: !!g.assignedBy,
  assignedByName: g.assignedByName || '',
  requireApproval: !!g.requireApproval,
});

async function loadGoalBundle(goalId) {
  const goal = await Goal.findById(goalId).lean();
  if (!goal) throw new RuleError('NOT_FOUND', 'Goal not found');
  const [topics, sessions] = await Promise.all([
    Topic.find({ goal: goalId }).sort({ order: 1, createdAt: 1 }).lean(),
    Session.find({ goal: goalId }).sort({ date: -1, createdAt: -1 }).lean(),
  ]);
  return { goal: plainGoal(goal), topics: topics.map(plainTopic), sessions: sessions.map(plainSession) };
}

async function loadTopic(topicId) {
  if (!/^[a-f\d]{24}$/i.test(String(topicId))) throw new RuleError('NOT_FOUND', 'Topic not found');
  const topic = await Topic.findById(topicId).lean();
  if (!topic) throw new RuleError('NOT_FOUND', 'Topic not found');
  const siblings = (await Topic.find({ goal: topic.goal }).sort({ order: 1, createdAt: 1 }).lean()).map(plainTopic);
  return { topic: plainTopic(topic), siblings };
}

/** Topics with their computed lock state attached, for API responses. */
function decorateTopics(topics, sessions) {
  const mins = Rules.minutesByTopic(sessions);
  const states = Rules.computeStates(topics, mins);
  const byId = new Map(topics.map((t) => [t.id, t]));
  return topics.map((t) => ({
    ...t,
    state: states[t.id].state,
    locked: states[t.id].locked,
    missing: states[t.id].missing.map((id) => ({ id, title: byId.get(id).title })),
    minutes: mins[t.id] || 0,
    dependents: Rules.directDependents(topics, t.id).map((d) => ({ id: d.id, title: d.title })),
  }));
}

/** Creates topics from a sanitised roadmap ({key, title, description, prerequisites:[keys], estimateMinutes}). */
async function createTopicsFromRoadmap(goalId, ownerId, roadmapTopics, startOrder = 0) {
  const ids = new Map();
  let order = startOrder;
  for (const t of roadmapTopics) {
    // sanitizeRoadmap returns prerequisites before dependants, so their ids already exist
    const doc = await Topic.create({
      goal: goalId, owner: ownerId, title: t.title, description: t.description || '', estimateMinutes: t.estimateMinutes || 0,
      prerequisites: t.prerequisites.map((k) => ids.get(k)).filter(Boolean), order: order++,
    });
    ids.set(t.key, doc._id);
  }
  return ids;
}

const isObjectId = (id) => /^[a-f\d]{24}$/i.test(String(id));

module.exports = { getConfig, saveConfig, plainTopic, plainSession, plainGoal, loadGoalBundle, loadTopic, decorateTopics, isObjectId, createTopicsFromRoadmap };
