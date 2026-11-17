require('dotenv').config();

const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && !env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = {
  isProd,
  port: Number(env.PORT) || 4000,
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/study_progress_tracker',
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  tz: env.APP_TZ || 'Asia/Kolkata',
  geminiKey: env.GEMINI_API_KEY || '',
  geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
  cookieSecure: env.COOKIE_SECURE === 'true',
};
