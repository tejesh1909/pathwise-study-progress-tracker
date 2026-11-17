const mongoose = require('mongoose');
const config = require('./config');
const { createApp } = require('./app');
const { Setting } = require('./models');
const Rules = require('../shared/rules');

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log('MongoDB connected');
  // make sure a settings document exists so admins always have something to edit
  await Setting.updateOne({ key: 'app' }, { $setOnInsert: { values: Rules.DEFAULT_CONFIG } }, { upsert: true });
  createApp().listen(config.port, () => console.log(`Study Progress Tracker → http://localhost:${config.port}`));
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
