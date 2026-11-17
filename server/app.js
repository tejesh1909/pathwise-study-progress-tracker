const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { errorHandler } = require('./middleware/errors');

function createApp() {
  const app = express();
  if (config.isProd) app.set('trust proxy', 1); // behind Render/Railway/etc.: real client IPs for rate limits
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          // Helmet's default would force https for sub-resources, which breaks plain-http localhost in Safari.
          upgradeInsecureRequests: null,
        },
      },
    })
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/share', require('./routes/share')); // public, read-only, token-addressed
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/config', require('./routes/config'));
  app.use('/api', require('./routes/dashboard'));
  app.use('/api', require('./routes/insights'));
  app.use('/api', require('./routes/export'));
  app.use('/api', require('./routes/ai'));
  app.use('/api', require('./routes/goals'));
  app.use('/api/sessions', require('./routes/sessions'));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

  // pure, secret-free business logic shared with the browser (landing-page roadmap demo, offline preview)
  app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
  const client = path.join(__dirname, '..', 'client');
  app.use(express.static(client));
  app.get('*', (req, res) => res.sendFile(path.join(client, 'index.html')));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
