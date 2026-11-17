const router = require('express').Router();
const { ah } = require('../middleware/errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getConfig, saveConfig } = require('../services/data');

// Everyone signed in can READ the configuration (forms show the limits); only the mentor/admin can change it.
router.get('/', requireAuth, ah(async (req, res) => res.json({ config: await getConfig() })));

router.put(
  '/',
  requireAuth,
  requireRole('mentor'),
  ah(async (req, res) => res.json({ config: await saveConfig(req.body || {}) }))
);

module.exports = router;
