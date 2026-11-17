const jwt = require('jsonwebtoken');
const config = require('../config');
const { User } = require('../models');
const { RuleError } = require('../../shared/rules');

const COOKIE = 'spt_token';

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, { expiresIn: '7d' });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

/** Loads the user from the cookie (or a Bearer token) and re-reads the role from the database every time,
 *  so a role can never be forged by editing a token or client-side state. */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = (req.cookies && req.cookies[COOKIE]) || (header.startsWith('Bearer ') ? header.slice(7) : null);
    if (!token) return res.status(401).json({ error: 'Please sign in', code: 'UNAUTHENTICATED' });
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Session expired — please sign in again', code: 'UNAUTHENTICATED' });
    }
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: 'Account no longer exists', code: 'UNAUTHENTICATED' });
    if (user.active === false) return res.status(401).json({ error: 'This account has been deactivated', code: 'UNAUTHENTICATED' });
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

const requireRole = (role) => (req, res, next) => {
  if (req.user.role !== role) return res.status(403).json({ error: `Only a ${role} can do this`, code: 'FORBIDDEN' });
  next();
};

/** Mentors may read anyone's data; learners only their own. */
function assertCanRead(user, ownerId) {
  if (user.role === 'mentor') return;
  if (String(user._id) !== String(ownerId)) throw new RuleError('FORBIDDEN', "You can't view another learner's data");
}

/** Only the owning learner may edit learner data — mentors are read-only on it. */
function assertCanEdit(user, ownerId) {
  if (user.role !== 'learner' || String(user._id) !== String(ownerId))
    throw new RuleError('FORBIDDEN', user.role === 'mentor' ? 'Mentors have view-only access to learner goals' : "You can only edit your own goals");
}

/** Goals a mentor assigned are structured by mentors; learners' own goals are structured by the learner. */
function canManageStructure(user, goal) {
  const assigned = !!(goal.assignedBy || goal.assigned);
  const owner = String(goal.owner || goal.ownerId);
  if (assigned) return user.role === 'mentor';
  return user.role === 'learner' && String(user._id) === owner;
}
function assertManageStructure(user, goal) {
  if (canManageStructure(user, goal)) return;
  const assigned = !!(goal.assignedBy || goal.assigned);
  throw new RuleError('FORBIDDEN', assigned ? (user.role === 'mentor' ? 'Not allowed' : 'This goal was assigned by your mentor, so only a mentor can change its structure') : user.role === 'mentor' ? 'Mentors have view-only access to learners\' own goals' : "You can only edit your own goals");
}

module.exports = { COOKIE, signToken, setAuthCookie, requireAuth, requireRole, assertCanRead, assertCanEdit, canManageStructure, assertManageStructure };
