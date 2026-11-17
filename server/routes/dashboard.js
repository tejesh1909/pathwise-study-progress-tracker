const router = require('express').Router();
const { User, Goal, Topic, Session } = require('../models');
const { ah } = require('../middleware/errors');
const { requireAuth, requireRole, assertCanRead } = require('../middleware/auth');
const Rules = require('../../shared/rules');
const Features = require('../../shared/features');
const { learnerSummaries } = require('../services/summary');
const { RuleError } = Rules;
const appConfig = require('../config');
const { getConfig, plainTopic, plainSession, plainGoal, isObjectId } = require('../services/data');

router.use(requireAuth);

/** Resolves which learner's data is being asked for, enforcing the role rules on the server. */
async function resolveLearner(req) {
  let id = req.user._id;
  if (req.user.role === 'mentor') {
    if (!isObjectId(req.query.learnerId)) throw new RuleError('VALIDATION', 'learnerId is required');
    id = req.query.learnerId;
  } else if (req.query.learnerId && String(req.query.learnerId) !== String(req.user._id)) {
    throw new RuleError('FORBIDDEN', "You can't view another learner's data");
  }
  const learner = await User.findById(id).select('name email role').lean();
  if (!learner || learner.role !== 'learner') throw new RuleError('NOT_FOUND', 'Learner not found');
  assertCanRead(req.user, learner._id);
  return learner;
}

async function learnerData(ownerId) {
  const [goals, topics, sessions] = await Promise.all([
    Goal.find({ owner: ownerId }).sort({ createdAt: 1 }).lean(),
    Topic.find({ owner: ownerId }).sort({ order: 1, createdAt: 1 }).lean(),
    Session.find({ owner: ownerId }).sort({ date: -1, createdAt: -1 }).lean(),
  ]);
  return { goals: goals.map(plainGoal), topics: topics.map(plainTopic), sessions: sessions.map(plainSession) };
}

router.get(
  '/dashboard',
  ah(async (req, res) => {
    const learner = await resolveLearner(req);
    const cfg = await getConfig();
    const today = Rules.todayInTz(appConfig.tz);
    const { goals, topics, sessions } = await learnerData(learner._id);
    const states = Rules.computeStates(topics, Rules.minutesByTopic(sessions));
    const goalTitle = new Map(goals.map((g) => [g.id, g]));
    const topicTitle = new Map(topics.map((t) => [t.id, t.title]));

    const goalCards = goals.map((g) => {
      const gt = topics.filter((t) => t.goalId === g.id);
      const gs = sessions.filter((s) => s.goalId === g.id);
      const next = gt.find((t) => ['in_progress', 'available'].includes(states[t.id].state));
      const forecast = Features.goalForecast({ goal: g, topics: gt, sessions: gs, config: cfg, today });
      return {
        ...g,
        forecast,
        pendingCount: gt.filter((t) => t.pending).length,
        progress: Rules.goalProgress(gt, gs),
        locked: gt.filter((t) => states[t.id].state === 'locked').length,
        nextUp: next ? { id: next.id, title: next.title, state: states[next.id].state } : null,
      };
    });

    const alerts = goalCards
      .filter((g) => Features.WARNING_STATUSES.includes(g.forecast.status))
      .map((g) => ({ goalId: g.id, title: g.title, color: g.color, status: g.forecast.status, headline: g.forecast.headline, requiredMinutesPerWeek: g.forecast.requiredMinutesPerWeek }));
    const last7 = sessions.filter((s) => s.date >= Rules.addDays(today, -6));
    res.json({
      learner: { id: String(learner._id), name: learner.name },
      today,
      config: cfg,
      totals: {
        goals: goals.length,
        topics: topics.length,
        topicsComplete: topics.filter((t) => t.complete).length,
        minutes: sessions.reduce((a, s) => a + s.minutes, 0),
        sessions: sessions.length,
        locked: topics.filter((t) => states[t.id].state === 'locked').length,
        weekMinutes: last7.reduce((a, s) => a + s.minutes, 0),
      },
      goals: goalCards,
      alerts,
      weekly: Rules.weeklySeries(sessions, today),
      heatmap: Rules.heatmap(sessions, today, 42),
      streak: Rules.streak(sessions, today),
      recent: sessions.slice(0, 8).map((s) => ({
        ...s,
        topicTitle: topicTitle.get(s.topicId) || 'Removed topic',
        goalTitle: (goalTitle.get(s.goalId) || {}).title || '',
        goalColor: (goalTitle.get(s.goalId) || {}).color || 'violet',
      })),
      readyToStart: topics
        .filter((t) => ['available', 'in_progress'].includes(states[t.id].state))
        .slice(0, 6)
        .map((t) => ({ id: t.id, goalId: t.goalId, title: t.title, state: states[t.id].state, goalTitle: (goalTitle.get(t.goalId) || {}).title, color: (goalTitle.get(t.goalId) || {}).color })),
      canEdit: req.user.role === 'learner',
    });
  })
);

// Mentor: overview of every learner (with at-risk goals, cohorts and pending approvals).
router.get(
  '/learners',
  requireRole('mentor'),
  ah(async (req, res) => {
    res.json({ learners: await learnerSummaries(), today: Rules.todayInTz(appConfig.tz) });
  })
);

module.exports = router;
module.exports.learnerData = learnerData;
module.exports.resolveLearner = resolveLearner;
