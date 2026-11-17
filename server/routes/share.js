/* Public, unauthenticated, read-only snapshot of ONE goal, addressed by an unguessable token.
 * Deliberately limited: first name only; no email, notes, resource links, mentor feedback or session notes. */
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { Share, Goal, User } = require('../models');
const { ah } = require('../middleware/errors');
const Rules = require('../../shared/rules');
const Features = require('../../shared/features');
const appConfig = require('../config');
const { getConfig, loadGoalBundle, decorateTopics } = require('../services/data');

const limiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests', code: 'RATE_LIMIT' } });
const gone = (res) => res.status(404).json({ error: 'This link is invalid, expired or has been revoked', code: 'NOT_FOUND' });

router.get(
  '/:token',
  limiter,
  ah(async (req, res) => {
    const token = String(req.params.token || '');
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return gone(res);
    const share = await Share.findOne({ token }).lean();
    if (!share || (share.expiresAt && share.expiresAt.getTime() < Date.now())) return gone(res);
    if (!(await Goal.exists({ _id: share.goal }))) return gone(res);
    const { goal, topics, sessions } = await loadGoalBundle(share.goal);
    const owner = await User.findById(goal.ownerId).select('name').lean();
    const cfg = await getConfig();
    const today = Rules.todayInTz(appConfig.tz);
    res.json({
      readOnly: true,
      learnerFirstName: owner ? String(owner.name).split(/\s+/)[0] : 'A learner',
      goal: { title: goal.title, description: goal.description, color: goal.color, targetDate: goal.targetDate },
      topics: decorateTopics(topics, sessions).map((t) => ({
        id: t.id, title: t.title, description: t.description, prerequisites: t.prerequisites, state: t.state, locked: t.locked,
        missing: t.missing, minutes: t.minutes, estimateMinutes: t.estimateMinutes, completedOn: t.completedOn,
      })),
      progress: Rules.goalProgress(topics, sessions),
      weekly: Rules.weeklySeries(sessions, today),
      forecast: Features.goalForecast({ goal, topics, sessions, config: cfg, today }),
      expiresAt: share.expiresAt,
      today,
    });
  })
);

router.all('/:token', (req, res) => res.status(405).set('Allow', 'GET').json({ error: 'Read-only', code: 'FORBIDDEN' }));

module.exports = router;
