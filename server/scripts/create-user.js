/* Create a user (e.g. a mentor/admin) from the command line:
 *   npm run create-user -- "Dr. Rao" rao@school.edu StrongPass123 mentor
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { User } = require('../models');

const [name, email, password, role = 'learner'] = process.argv.slice(2);
if (!name || !email || !password || !['learner', 'mentor'].includes(role)) {
  console.error('Usage: npm run create-user -- "<name>" <email> <password (8+ chars)> [learner|mentor]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters');
  process.exit(1);
}

mongoose
  .connect(config.mongoUri)
  .then(async () => {
    await User.create({ name, email, passwordHash: await bcrypt.hash(password, 10), role });
    console.log(`Created ${role} ${email}`);
  })
  .catch((e) => console.error(e.code === 11000 ? 'That email already exists' : e.message))
  .finally(() => mongoose.disconnect());
