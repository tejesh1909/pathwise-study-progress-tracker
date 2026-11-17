const router = require('express').Router();
const crypto = require('crypto');
const { Goal, Topic, Session, User, Feedback, Share, QuizAttempt } = require('../models');
const { ah } = require('../middleware/errors');
const { requireAuth, requireRole, assertCanRead, assertCanEdit, canManageStructure, assertManageStructure } = require('../middleware/auth');
const Rules = require('../../shared/rules');
const Features = require('../../shared/features');
const { RuleError } = Rules;
const config = require('../config');
const { getConfig, loadGoalBundle, loadTopic, decorateTopics, plainTopic, plainGoal, isObjectId, createTopicsFromRoadmap } = require('../services/data');

router.use(requireAuth);

/** The full, role-checked view of a goal that the UI renders. */
async function goalPayload(goalId, viewer, extra) {
  if (!isObjectId(goalId)) throw new RuleError('NOT_FOUND', 'Goal not found');
  const { goal, topics, sessions } = await loadGoalBundle(goalId);
  assertCanRead(viewer, goal.ownerId);
  const cfg = await getConfig();
  const today = Rules.todayInTz(config.tz);
  const isOwner = viewer.role === 'learner' && String(viewer._id) === goal.ownerId;
  const [owner, feedback, shares] = await Promise.all([
    User.findById(goal.ownerId).select('name').lean(),
    Feedback.find({ goal: goalId }).sort({ createdAt: -1 }).limit(20).lean(),
    isOwner ? Share.find({ goal: goalId }).sort({ createdAt: -1 }).lean() : [],
  ]);
  const titles = new Map(topics.map((t) => [t.id, t.title]));
  return Object.assign(
    {
      goal,
      owner: { id: goal.ownerId, name: owner ? owner.name : 'Unknown' },
      topics: decorateTopics(topics, sessions),
      sessions: sessions.slice(0, 60).map((s) => ({ ...s, topicTitle: titles.get(s.topicId) || 'Removed topic' })),
      progress: Rules.goalProgress(topics, sessions),
      weekly: Rules.weeklySeries(sessions, today),
      feedback: feedback.map((f) => ({ id: String(f._id), authorName: f.authorName, text: f.text, createdAt: f.createdAt })),
      forecast: Features.goalForecast({ goal, topics, sessions, config: cfg, today }),
      canEdit: isOwner, // may study: log sessions, submit topics, keep notes
      canStructure: canManageStructure(viewer, goal), // may add / edit / remove topics
      canApprove: viewer.role === 'mentor' && goal.requireApproval,
      shares: shares.map((x) => ({ id: String(x._id), token: x.token, expiresAt: x.expiresAt, createdAt: x.createdAt })),
      config: cfg,
      today,
    },
    extra || {}
  );
}

/* ----- list ----- */
router.get(
  '/goals',
  ah(async (req, res) => {
    let ownerId = req.user._id;
    if (req.user.role === 'mentor') {
      if (!req.query.learnerId || !isObjectId(req.query.learnerId)) throw new RuleError('VALIDATION', 'learnerId is required');
      ownerId = req.query.learnerId;
    } else if (req.query.learnerId && String(req.query.learnerId) !== String(req.user._id)) {
      throw new RuleError('FORBIDDEN', "You can't view another learner's goals");
    }
    const goals = (await Goal.find({ owner: ownerId }).sort({ createdAt: 1 }).lean()).map(plainGoal);
    const [topics, sessions] = await Promise.all([Topic.find({ owner: ownerId }).lean(), Session.find({ owner: ownerId }).lean()]);
    const pt = topics.map(plainTopic);
    const cfgAll = await getConfig();
    const todayAll = Rules.todayInTz(config.tz);
    res.json({
      goals: goals.map((g) => {
        const gt = pt.filter((t) => t.goalId === g.id);
        const gs = sessions.filter((s) => String(s.goal) === g.id).map((s) => ({ minutes: s.minutes, topicId: String(s.topic), date: s.date }));
        return { ...g, progress: Rules.goalProgress(gt, gs), forecast: Features.goalForecast({ goal: g, topics: gt, sessions: gs, config: cfgAll, today: todayAll }) };
      }),
    });
  })
);

/* ----- create / update / delete goal (learner, own data) ----- */
router.post(
  '/goals',
  requireRole('learner'),
  ah(async (req, res) => {
    const data = Rules.validateGoalInput(req.body);
    const goal = await Goal.create({ ...data, owner: req.user._id });
    res.status(201).json(await goalPayload(goal._id, req.user));
  })
);

router.get('/goals/:id', ah(async (req, res) => res.json(await goalPayload(req.params.id, req.user))));

router.put(
  '/goals/:id',
  ah(async (req, res) => {
    const goal = isObjectId(req.params.id) && (await Goal.findById(req.params.id));
    if (!goal) throw new RuleError('NOT_FOUND', 'Goal not found');
    assertManageStructure(req.user, goal);
    Object.assign(goal, Rules.validateGoalInput({ ...plainGoal(goal), ...req.body }));
    await goal.save();
    res.json(await goalPayload(goal._id, req.user));
  })
);

router.delete(
  '/goals/:id',
  ah(async (req, res) => {
    const goal = isObjectId(req.params.id) && (await Goal.findById(req.params.id));
    if (!goal) throw new RuleError('NOT_FOUND', 'Goal not found');
    assertManageStructure(req.user, goal);
    await Promise.all([Topic.deleteMany({ goal: goal._id }), Session.deleteMany({ goal: goal._id }), Feedback.deleteMany({ goal: goal._id }), Share.deleteMany({ goal: goal._id })]);
    await goal.deleteOne();
    res.json({ ok: true });
  })
);

/* ----- topics ----- */
router.post(
  '/goals/:id/topics',
  ah(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new RuleError('NOT_FOUND', 'Goal not found');
    const goal = await Goal.findById(req.params.id);
    if (!goal) throw new RuleError('NOT_FOUND', 'Goal not found');
    assertManageStructure(req.user, goal);
    const cfg = await getConfig();
    const { topics } = await loadGoalBundle(goal._id);
    const data = Rules.validateTopicInput(req.body);
    const prerequisites = Rules.validatePrerequisites({ topics, topicId: null, prerequisites: req.body.prerequisites, config: cfg });
    await Topic.create({ ...data, prerequisites, goal: goal._id, owner: goal.owner, order: topics.length });
    res.status(201).json(await goalPayload(goal._id, req.user));
  })
);

router.put(
  '/topics/:id',
  ah(async (req, res) => {
    const { topic, siblings } = await loadTopic(req.params.id);
    assertManageStructure(req.user, await Goal.findById(topic.goalId).lean());
    const cfg = await getConfig();
    const data = Rules.validateTopicInput({ ...topic, ...req.body });
    let prerequisites = topic.prerequisites;
    if (req.body.prerequisites !== undefined) {
      prerequisites = Rules.validatePrerequisites({ topics: siblings, topicId: topic.id, prerequisites: req.body.prerequisites, config: cfg });
      const byId = new Map(siblings.map((t) => [t.id, t]));
      const incomplete = prerequisites.filter((id) => !byId.get(id).complete);
      if (topic.complete && incomplete.length)
        throw new RuleError('CONFLICT', `Reopen "${topic.title}" before adding an unfinished prerequisite (${byId.get(incomplete[0]).title})`);
    }
    await Topic.updateOne({ _id: topic.id }, { ...data, prerequisites });
    res.json(await goalPayload(topic.goalId, req.user));
  })
);

router.delete(
  '/topics/:id',
  ah(async (req, res) => {
    const { topic } = await loadTopic(req.params.id);
    assertManageStructure(req.user, await Goal.findById(topic.goalId).lean());
    await Promise.all([
      Topic.updateMany({ goal: topic.goalId }, { $pull: { prerequisites: topic.id } }),
      Session.deleteMany({ topic: topic.id }),
      Topic.deleteOne({ _id: topic.id }),
    ]);
    res.json(await goalPayload(topic.goalId, req.user));
  })
);

/* ----- the unlock rule in action ----- */
router.post(
  '/topics/:id/complete',
  ah(async (req, res) => {
    const { topic, siblings } = await loadTopic(req.params.id);
    assertCanEdit(req.user, topic.ownerId);
    const goal = await Goal.findById(topic.goalId).lean();
    const before = Rules.computeStates(siblings);
    // throws LOCKED with the missing prerequisites; with approval required it submits instead of completing
    const plan = Rules.planComplete(siblings, topic.id, { needsApproval: !!goal.requireApproval });
    if (plan.changed.length) {
      if (plan.pending) await Topic.updateOne({ _id: topic.id }, { pending: true, pendingAt: new Date(), review: null });
      else await Topic.updateOne({ _id: topic.id }, { complete: true, completedOn: Rules.todayInTz(config.tz), pending: false });
    }
    const payload = await goalPayload(topic.goalId, req.user);
    const unlocked = payload.topics.filter((t) => before[t.id].state === 'locked' && !t.locked).map((t) => ({ id: t.id, title: t.title }));
    res.json({ ...payload, unlocked, submitted: !!plan.pending });
  })
);

router.post(
  '/topics/:id/reopen',
  ah(async (req, res) => {
    const { topic, siblings } = await loadTopic(req.params.id);
    assertCanEdit(req.user, topic.ownerId);
    const cfg = await getConfig();
    const plan = Rules.planReopen(siblings, topic.id, cfg);
    if (plan.reopened.length) await Topic.updateMany({ _id: { $in: plan.reopened } }, { complete: false, completedOn: '', pending: false, pendingAt: null });
    res.json({ ...(await goalPayload(topic.goalId, req.user)), reopened: plan.reopened, relocked: plan.relocked });
  })
);

/* ----- mentor approval ----- */
router.post(
  '/topics/:id/approve',
  requireRole('mentor'),
  ah(async (req, res) => {
    const { topic, siblings } = await loadTopic(req.params.id);
    Rules.planApprove(siblings, topic.id); // CONFLICT unless submitted; LOCKED if a prerequisite was reopened
    await Topic.updateOne({ _id: topic.id }, { complete: true, completedOn: Rules.todayInTz(config.tz), pending: false, review: { status: 'approved', comment: String((req.body && req.body.comment) || '').slice(0, 300), by: req.user._id, byName: req.user.name, at: new Date() } });
    res.json(await goalPayload(topic.goalId, req.user));
  })
);

router.post(
  '/topics/:id/reject',
  requireRole('mentor'),
  ah(async (req, res) => {
    const { topic, siblings } = await loadTopic(req.params.id);
    Rules.planReject(siblings, topic.id);
    const comment = String((req.body && req.body.comment) || '').trim();
    if (!comment || comment.length > 300) throw new RuleError('VALIDATION', 'Tell the learner what to fix (1–300 characters)', { fields: { comment: 'Write 1–300 characters' } });
    await Topic.updateOne({ _id: topic.id }, { pending: false, pendingAt: null, review: { status: 'changes', comment, by: req.user._id, byName: req.user.name, at: new Date() } });
    res.json(await goalPayload(topic.goalId, req.user));
  })
);

/* ----- personal notes + resource links (the learner's own, even on an assigned goal) ----- */
router.put(
  '/topics/:id/notes',
  ah(async (req, res) => {
    const { topic } = await loadTopic(req.params.id);
    assertCanEdit(req.user, topic.ownerId);
    const body = req.body || {};
    const data = Rules.validateTopicInput({ ...topic, notes: body.notes !== undefined ? body.notes : topic.notes, resources: body.resources !== undefined ? body.resources : topic.resources });
    await Topic.updateOne({ _id: topic.id }, { notes: data.notes, resources: data.resources });
    res.json(await goalPayload(topic.goalId, req.user));
  })
);

/* ----- create a goal + topics from a (reviewed) roadmap ----- */
router.post(
  '/goals/import',
  requireRole('learner'),
  ah(async (req, res) => {
    const body = req.body || {};
    const cfg = await getConfig();
    const meta = Rules.validateGoalInput(body.goal || { title: body.title });
    const road = Features.sanitizeRoadmap({ topics: body.topics }, cfg); // loops / unknown prerequisites / limits repaired
    const goal = await Goal.create({ ...meta, owner: req.user._id });
    await createTopicsFromRoadmap(goal._id, req.user._id, road.topics);
    res.status(201).json(await goalPayload(goal._id, req.user));
  })
);

/* ----- read-only share links (owner only) ----- */
router.post(
  '/goals/:id/shares',
  requireRole('learner'),
  ah(async (req, res) => {
    const goal = isObjectId(req.params.id) && (await Goal.findById(req.params.id));
    if (!goal) throw new RuleError('NOT_FOUND', 'Goal not found');
    assertCanEdit(req.user, goal.owner);
    const days = Number((req.body || {}).days);
    if (![0, 7, 30, 90].includes(days)) throw new RuleError('VALIDATION', 'Choose 7, 30, 90 days or no expiry');
    await Share.create({ token: crypto.randomBytes(24).toString('base64url'), goal: goal._id, owner: goal.owner, createdBy: req.user._id, expiresAt: days ? new Date(Date.now() + days * 86400000) : null });
    res.status(201).json(await goalPayload(goal._id, req.user));
  })
);

router.delete(
  '/shares/:id',
  ah(async (req, res) => {
    const sh = isObjectId(req.params.id) && (await Share.findById(req.params.id));
    if (!sh) throw new RuleError('NOT_FOUND', 'Share link not found');
    assertCanEdit(req.user, sh.owner);
    await sh.deleteOne();
    res.json(await goalPayload(sh.goal, req.user));
  })
);

/* ----- mentor feedback (extra) ----- */
router.post(
  '/goals/:id/feedback',
  requireRole('mentor'),
  ah(async (req, res) => {
    if (!isObjectId(req.params.id) || !(await Goal.exists({ _id: req.params.id }))) throw new RuleError('NOT_FOUND', 'Goal not found');
    const text = String((req.body && req.body.text) || '').trim();
    if (!text || text.length > 600) throw new RuleError('VALIDATION', 'Write 1–600 characters', { fields: { text: 'Write 1–600 characters' } });
    await Feedback.create({ goal: req.params.id, author: req.user._id, authorName: req.user.name, text });
    res.status(201).json(await goalPayload(req.params.id, req.user));
  })
);

module.exports = router;
