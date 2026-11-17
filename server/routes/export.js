const router = require('express').Router();
const { ah } = require('../middleware/errors');
const { requireAuth } = require('../middleware/auth');
const Rules = require('../../shared/rules');
const Features = require('../../shared/features');
const { RuleError } = Rules;
const appConfig = require('../config');
const { getConfig, isObjectId } = require('../services/data');
const { learnerData, resolveLearner } = require('./dashboard');
const { buildPdf } = require('../services/pdf');

router.use(requireAuth);

async function scope(req) {
  const learner = await resolveLearner(req); // enforces who may read whose data
  let { goals, topics, sessions } = await learnerData(learner._id);
  if (req.query.goalId) {
    if (!isObjectId(req.query.goalId) || !goals.some((g) => g.id === req.query.goalId)) throw new RuleError('NOT_FOUND', 'Goal not found');
    goals = goals.filter((g) => g.id === req.query.goalId);
    topics = topics.filter((t) => t.goalId === req.query.goalId);
    sessions = sessions.filter((s) => s.goalId === req.query.goalId);
  }
  return { learner, goals, topics, sessions };
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'learner';

router.get('/export/progress.csv', ah(async (req, res) => {
  const kind = req.query.kind === 'sessions' ? 'sessions' : 'topics';
  const { learner, goals, topics, sessions } = await scope(req);
  const csv = '﻿' + (kind === 'sessions' ? Features.sessionsCsv({ goals, topics, sessions }) : Features.topicsCsv({ goals, topics, sessions }));
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="pathwise-${kind}-${slug(learner.name)}.csv"`, 'Cache-Control': 'no-store' });
  res.send(csv);
}));

router.get('/export/progress.pdf', ah(async (req, res) => {
  const { learner, goals, topics, sessions } = await scope(req);
  const cfg = await getConfig();
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="pathwise-progress-${slug(learner.name)}.pdf"`, 'Cache-Control': 'no-store' });
  buildPdf({ learner, goals, topics, sessions, config: cfg, today: Rules.todayInTz(appConfig.tz) }).pipe(res);
}));

module.exports = router;
