/* Per-learner roll-up used by the mentor overview and cohort stats. */
const { User, Goal, Topic, Session } = require('../models');
const Rules = require('../../shared/rules');
const Features = require('../../shared/features');
const appConfig = require('../config');
const { getConfig, plainTopic, plainSession, plainGoal } = require('./data');

async function learnerSummaries() {
  const today = Rules.todayInTz(appConfig.tz);
  const cfg = await getConfig();
  const [learners, goals, topics, sessions] = await Promise.all([
    User.find({ role: 'learner', active: { $ne: false } }).sort({ name: 1 }).lean(),
    Goal.find({}).lean(), Topic.find({}).lean(), Session.find({}).lean(),
  ]);
  const { Cohort } = require('../models');
  const cohorts = await Cohort.find({}).lean();
  return learners.map((l) => {
    const id = String(l._id);
    const g = goals.filter((x) => String(x.owner) === id).map(plainGoal);
    const t = topics.filter((x) => String(x.owner) === id).map(plainTopic);
    const s = sessions.filter((x) => String(x.owner) === id).map(plainSession).sort((a, b) => (a.date < b.date ? 1 : -1));
    const done = t.filter((x) => x.complete).length;
    const atRisk = g.filter((goal) => Features.WARNING_STATUSES.includes(Features.goalForecast({ goal, topics: t.filter((x) => x.goalId === goal.id), sessions: s.filter((x) => x.goalId === goal.id), config: cfg, today }).status)).length;
    return {
      id, name: l.name, email: l.email, goals: g.length, topics: t.length, topicsComplete: done,
      percent: t.length ? Math.round((done / t.length) * 100) : 0,
      minutes: s.reduce((a, x) => a + x.minutes, 0),
      weekMinutes: s.filter((x) => x.date >= Rules.addDays(today, -6)).reduce((a, x) => a + x.minutes, 0),
      streak: Rules.streak(s, today), lastActive: s.length ? s[0].date : null,
      atRisk, pendingApprovals: t.filter((x) => x.pending).length,
      cohorts: cohorts.filter((c) => c.members.some((m) => String(m) === id)).map((c) => ({ id: String(c._id), name: c.name })),
    };
  });
}

module.exports = { learnerSummaries };
