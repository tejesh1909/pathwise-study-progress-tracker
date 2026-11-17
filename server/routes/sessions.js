const router = require('express').Router();
const { Session, Topic, Goal } = require('../models');
const { ah } = require('../middleware/errors');
const { requireAuth, assertCanRead, assertCanEdit } = require('../middleware/auth');
const Rules = require('../../shared/rules');
const { RuleError } = Rules;
const appConfig = require('../config');
const { getConfig, loadTopic, plainSession, isObjectId } = require('../services/data');

router.use(requireAuth);

router.get(
  '/',
  ah(async (req, res) => {
    const q = {};
    if (req.user.role === 'learner') q.owner = req.user._id;
    else if (req.query.learnerId && isObjectId(req.query.learnerId)) q.owner = req.query.learnerId;
    else throw new RuleError('VALIDATION', 'learnerId is required');
    if (req.query.goalId && isObjectId(req.query.goalId)) q.goal = req.query.goalId;
    if (req.query.topicId && isObjectId(req.query.topicId)) q.topic = req.query.topicId;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const rows = await Session.find(q).sort({ date: -1, createdAt: -1 }).limit(limit).populate('topic', 'title').populate('goal', 'title color').lean();
    res.json({
      sessions: rows.map((s) => ({
        ...plainSession(s),
        topicId: String(s.topic._id || s.topic),
        topicTitle: s.topic.title || 'Removed topic',
        goalId: String(s.goal._id || s.goal),
        goalTitle: s.goal.title || '',
        goalColor: s.goal.color || 'violet',
      })),
    });
  })
);

router.post(
  '/',
  ah(async (req, res) => {
    const body = req.body || {};
    if (!isObjectId(body.topicId)) throw new RuleError('VALIDATION', 'Please fix the highlighted fields', { fields: { topic: 'Choose a topic' } });
    const { topic, siblings } = await loadTopic(body.topicId);
    assertCanEdit(req.user, topic.ownerId);
    const cfg = await getConfig();
    const state = Rules.computeStates(siblings)[topic.id];
    // enforced in code: configurable min/max minutes, no future dates, no sessions on locked topics
    const clean = Rules.validateSession({ input: body, topic, state, config: cfg, today: Rules.todayInTz(appConfig.tz) });
    const session = await Session.create({ ...clean, owner: topic.ownerId, goal: topic.goalId, topic: topic.id });
    res.status(201).json({ session: plainSession(session) });
  })
);

router.delete(
  '/:id',
  ah(async (req, res) => {
    const s = isObjectId(req.params.id) && (await Session.findById(req.params.id));
    if (!s) throw new RuleError('NOT_FOUND', 'Session not found');
    assertCanEdit(req.user, s.owner);
    await s.deleteOne();
    res.json({ ok: true });
  })
);

module.exports = router;
