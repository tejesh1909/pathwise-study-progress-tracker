const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { User } = require('../models');
const { ah } = require('../middleware/errors');
const { signToken, setAuthCookie, requireAuth, COOKIE } = require('../middleware/auth');
const { RuleError } = require('../../shared/rules');

const publicUser = (u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role });
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts — try again in a few minutes', code: 'RATE_LIMIT' } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Self-registration always creates a LEARNER. Mentors are created by an existing mentor (People screen) or by an operator (npm run create-user / seed).
router.post(
  '/register',
  limiter,
  ah(async (req, res) => {
    const { name, email, password } = req.body || {};
    const fields = {};
    if (!name || String(name).trim().length < 2) fields.name = 'Enter your name';
    if (!EMAIL_RE.test(String(email || ''))) fields.email = 'Enter a valid email';
    if (!password || String(password).length < 8) fields.password = 'At least 8 characters';
    if (Object.keys(fields).length) throw new RuleError('VALIDATION', 'Please fix the highlighted fields', { fields });
    const exists = await User.findOne({ email: String(email).toLowerCase() });
    if (exists) throw new RuleError('VALIDATION', 'That email is already registered', { fields: { email: 'Already registered' } });
    const user = await User.create({
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      passwordHash: await bcrypt.hash(String(password), 10),
      role: 'learner',
    });
    setAuthCookie(res, signToken(user));
    res.status(201).json({ user: publicUser(user) });
  })
);

router.post(
  '/login',
  limiter,
  ah(async (req, res) => {
    const { email, password } = req.body || {};
    const user = await User.findOne({ email: String(email || '').toLowerCase().trim() });
    const ok = user && (await bcrypt.compare(String(password || ''), user.passwordHash));
    if (ok && user.active === false) return res.status(401).json({ error: 'This account has been deactivated — ask your mentor', code: 'UNAUTHENTICATED' });
    if (!ok) return res.status(401).json({ error: 'Wrong email or password', code: 'UNAUTHENTICATED' });
    setAuthCookie(res, signToken(user));
    res.json({ user: publicUser(user) });
  })
);

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

router.post(
  '/change-password',
  requireAuth,
  limiter,
  ah(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!(await bcrypt.compare(String(currentPassword || ''), req.user.passwordHash))) throw new RuleError('VALIDATION', 'Please fix the highlighted fields', { fields: { currentPassword: 'Incorrect password' } });
    if (!newPassword || String(newPassword).length < 8) throw new RuleError('VALIDATION', 'Please fix the highlighted fields', { fields: { newPassword: 'At least 8 characters' } });
    req.user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    await req.user.save();
    res.json({ ok: true });
  })
);

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

module.exports = router;
