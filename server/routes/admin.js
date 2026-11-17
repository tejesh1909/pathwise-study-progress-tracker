/* Mentor-only administration: people, cohorts, goal assignment and the approvals inbox. */
const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { User, Goal, Topic, Session, Cohort } = require('../models');
const { ah } = require('../middleware/errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const Rules = require('../../shared/rules');
const Features = require('../../shared/features');
const { RuleError } = Rules;
const appConfig = require('../config');
const { getConfig, isObjectId, createTopicsFromRoadmap } = require('../services/data');
const { learnerSummaries } = require('../services/summary');

router.use(requireAuth, requireRole('mentor'));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pub = (u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, active: u.active !== false, createdAt: u.createdAt });
const tempPassword = () => crypto.randomBytes(9).toString('base64url');
const vErr = (fields) => new RuleError('VALIDATION', 'Please fix the highlighted fields', { fields });

/* ----- people ----- */
router.get('/users', ah(async (req, res) => {
  const users = await User.find({}).sort({ role: -1, name: 1 }).lean();
  const cohorts = await Cohort.find({}).lean();
  res.json({ users: users.map((u) => ({ ...pub(u), cohorts: cohorts.filter((c) => c.members.some((m) => String(m) === String(u._id))).map((c) => ({ id: String(c._id), name: c.name })) })) });
}));

router.post('/users', ah(async (req, res) => {
  const { name, email, role, password } = req.body || {};
  const fields = {};
  if (!name || String(name).trim().length < 2) fields.name = 'Enter a name';
  if (!EMAIL_RE.test(String(email || ''))) fields.email = 'Enter a valid email';
  if (!['learner', 'mentor'].includes(role)) fields.role = 'Choose learner or mentor';
  if (password && String(password).length < 8) fields.password = 'At least 8 characters';
  if (Object.keys(fields).length) throw vErr(fields);
  if (await User.exists({ email: String(email).toLowerCase().trim() })) throw vErr({ email: 'Already registered' });
  const pw = password ? String(password) : tempPassword();
  const user = await User.create({ name: String(name).trim(), email: String(email).toLowerCase().trim(), role, passwordHash: await bcrypt.hash(pw, 10) });
  // a generated password is returned once, so the mentor can hand it over
  res.status(201).json({ user: pub(user), tempPassword: password ? null : pw });
}));

async function activeMentorCount(excludeId) {
  return User.countDocuments({ role: 'mentor', active: { $ne: false }, _id: { $ne: excludeId } });
}

router.put('/users/:id', ah(async (req, res) => {
  const user = isObjectId(req.params.id) && (await User.findById(req.params.id));
  if (!user) throw new RuleError('NOT_FOUND', 'User not found');
  const b = req.body || {};
  const self = String(user._id) === String(req.user._id);
  if (b.name !== undefined) {
    if (String(b.name).trim().length < 2) throw vErr({ name: 'Enter a name' });
    user.name = String(b.name).trim();
  }
  if (b.role !== undefined && b.role !== user.role) {
    if (!['learner', 'mentor'].includes(b.role)) throw vErr({ role: 'Choose learner or mentor' });
    if (self) throw new RuleError('CONFLICT', "You can't change your own role");
    if (user.role === 'mentor' && (await activeMentorCount(user._id)) === 0) throw new RuleError('CONFLICT', 'There must always be at least one active mentor');
    user.role = b.role;
  }
  if (b.active !== undefined && !!b.active !== (user.active !== false)) {
    if (!b.active) {
      if (self) throw new RuleError('CONFLICT', "You can't deactivate your own account");
      if (user.role === 'mentor' && (await activeMentorCount(user._id)) === 0) throw new RuleError('CONFLICT', 'There must always be at least one active mentor');
    }
    user.active = !!b.active;
  }
  await user.save();
  res.json({ user: pub(user) });
}));

router.post('/users/:id/reset-password', ah(async (req, res) => {
  const user = isObjectId(req.params.id) && (await User.findById(req.params.id));
  if (!user) throw new RuleError('NOT_FOUND', 'User not found');
  const pw = tempPassword();
  user.passwordHash = await bcrypt.hash(pw, 10);
  await user.save();
  res.json({ tempPassword: pw });
}));

/* ----- cohorts ----- */
async function cohortPayload() {
  const [cohorts, summaries] = await Promise.all([Cohort.find({}).sort({ name: 1 }).lean(), learnerSummaries()]);
  const byId = new Map(summaries.map((s) => [s.id, s]));
  return cohorts.map((c) => {
    const members = c.members.map((m) => byId.get(String(m))).filter(Boolean);
    return {
      id: String(c._id), name: c.name, description: c.description || '',
      memberIds: members.map((m) => m.id), members: members.map((m) => ({ id: m.id, name: m.name })),
      stats: {
        learners: members.length,
        avgPercent: members.length ? Math.round(members.reduce((a, m) => a + m.percent, 0) / members.length) : 0,
        weekMinutes: members.reduce((a, m) => a + m.weekMinutes, 0),
        atRisk: members.reduce((a, m) => a + m.atRisk, 0),
        pendingApprovals: members.reduce((a, m) => a + m.pendingApprovals, 0),
      },
    };
  });
}
async function cohortInput(body) {
  const name = String((body && body.name) || '').trim();
  if (name.length < 2 || name.length > 60) throw vErr({ name: 'Name must be 2–60 characters' });
  const ids = Array.isArray(body.memberIds) ? [...new Set(body.memberIds.map(String))] : [];
  if (!ids.every(isObjectId)) throw vErr({ members: 'Invalid learner' });
  const found = await User.find({ _id: { $in: ids }, role: 'learner' }).select('_id').lean();
  if (found.length !== ids.length) throw vErr({ members: 'Cohorts can only contain learners' });
  return { name, description: String(body.description || '').slice(0, 300), members: ids };
}
router.get('/cohorts', ah(async (req, res) => res.json({ cohorts: await cohortPayload() })));
router.post('/cohorts', ah(async (req, res) => {
  const data = await cohortInput(req.body || {});
  if (await Cohort.exists({ name: data.name })) throw vErr({ name: 'A cohort with this name already exists' });
  await Cohort.create(data);
  res.status(201).json({ cohorts: await cohortPayload() });
}));
router.put('/cohorts/:id', ah(async (req, res) => {
  const c = isObjectId(req.params.id) && (await Cohort.findById(req.params.id));
  if (!c) throw new RuleError('NOT_FOUND', 'Cohort not found');
  const data = await cohortInput({ ...c.toObject(), memberIds: c.members.map(String), ...(req.body || {}) });
  if (await Cohort.exists({ name: data.name, _id: { $ne: c._id } })) throw vErr({ name: 'A cohort with this name already exists' });
  Object.assign(c, data);
  await c.save();
  res.json({ cohorts: await cohortPayload() });
}));
router.delete('/cohorts/:id', ah(async (req, res) => {
  if (!isObjectId(req.params.id) || !(await Cohort.findByIdAndDelete(req.params.id))) throw new RuleError('NOT_FOUND', 'Cohort not found');
  res.json({ cohorts: await cohortPayload() });
}));

/* ----- assign a goal (with its topics) to learners and/or whole cohorts ----- */
router.post('/assign', ah(async (req, res) => {
  const b = req.body || {};
  const cfg = await getConfig();
  const meta = Rules.validateGoalInput(b.goal || {});
  const road = Features.sanitizeRoadmap({ topics: b.topics }, cfg);
  const ids = new Set((Array.isArray(b.learnerIds) ? b.learnerIds : []).map(String));
  for (const cid of Array.isArray(b.cohortIds) ? b.cohortIds : []) {
    const c = isObjectId(cid) && (await Cohort.findById(cid).lean());
    if (!c) throw new RuleError('NOT_FOUND', 'Cohort not found');
    c.members.forEach((m) => ids.add(String(m)));
  }
  if (!ids.size) throw vErr({ learnerIds: 'Choose at least one learner or cohort' });
  if (![...ids].every(isObjectId)) throw vErr({ learnerIds: 'Invalid learner' });
  const learners = await User.find({ _id: { $in: [...ids] }, role: 'learner', active: { $ne: false } }).lean();
  if (learners.length !== ids.size) throw vErr({ learnerIds: 'Only active learners can be assigned goals' });
  for (const l of learners) {
    const goal = await Goal.create({ ...meta, owner: l._id, assignedBy: req.user._id, assignedByName: req.user.name, requireApproval: !!b.requireApproval });
    await createTopicsFromRoadmap(goal._id, l._id, road.topics);
  }
  res.status(201).json({ assignedTo: learners.map((l) => ({ id: String(l._id), name: l.name })), topics: road.topics.length });
}));

router.get('/assigned', ah(async (req, res) => {
  const goals = await Goal.find({ assignedBy: { $ne: null } }).sort({ createdAt: -1 }).lean();
  const owners = new Map((await User.find({ _id: { $in: goals.map((g) => g.owner) } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  const topics = await Topic.find({ goal: { $in: goals.map((g) => g._id) } }).lean();
  res.json({
    assigned: goals.map((g) => {
      const gt = topics.filter((t) => String(t.goal) === String(g._id));
      return { id: String(g._id), title: g.title, learnerId: String(g.owner), learnerName: owners.get(String(g.owner)) || '?', targetDate: g.targetDate, requireApproval: !!g.requireApproval, assignedByName: g.assignedByName, topics: gt.length, complete: gt.filter((t) => t.complete).length, pending: gt.filter((t) => t.pending).length, createdAt: g.createdAt };
    }),
  });
}));

/* ----- approvals inbox ----- */
router.get('/approvals', ah(async (req, res) => {
  const pending = await Topic.find({ pending: true }).sort({ pendingAt: 1 }).lean();
  const goals = new Map((await Goal.find({ _id: { $in: pending.map((t) => t.goal) } }).lean()).map((g) => [String(g._id), g]));
  const users = new Map((await User.find({ _id: { $in: pending.map((t) => t.owner) } }).select('name').lean()).map((u) => [String(u._id), u.name]));
  const mins = await Session.aggregate([{ $match: { topic: { $in: pending.map((t) => t._id) } } }, { $group: { _id: '$topic', minutes: { $sum: '$minutes' } } }]);
  const minBy = new Map(mins.map((m) => [String(m._id), m.minutes]));
  res.json({
    approvals: pending.map((t) => {
      const g = goals.get(String(t.goal)) || {};
      return { topicId: String(t._id), title: t.title, goalId: String(t.goal), goalTitle: g.title || '', color: g.color || 'violet', learnerId: String(t.owner), learnerName: users.get(String(t.owner)) || '?', submittedAt: t.pendingAt, minutes: minBy.get(String(t._id)) || 0, estimateMinutes: t.estimateMinutes || 0 };
    }),
  });
}));

module.exports = router;
