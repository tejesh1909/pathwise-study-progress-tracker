/* AI features: roadmap generator, per-topic quiz, study coach. Gemini is used when GEMINI_API_KEY is set;
 * otherwise (or on any failure / invalid output) the built-in logic answers, and the response says which. */
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { Goal, Topic, QuizAttempt } = require('../models');
const { ah } = require('../middleware/errors');
const { requireAuth, assertCanRead, assertCanEdit } = require('../middleware/auth');
const Rules = require('../../shared/rules');
const Features = require('../../shared/features');
const { RuleError } = Rules;
const appConfig = require('../config');
const { callAI, extractJson, enabled } = require('../services/ai');
const { getConfig, loadTopic, loadGoalBundle, plainGoal, plainTopic, plainSession, isObjectId } = require('../services/data');
const { Session } = require('../models');

const aiLimit = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => String(req.user._id), message: { error: 'Slow down — too many AI requests', code: 'RATE_LIMIT' } });
// applied per route (this router is mounted at /api, so a router-level limiter would throttle every endpoint)

const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

/* ----- roadmap generator ----- */
router.post('/ai/roadmap', requireAuth, aiLimit, ah(async (req, res) => {
  const subject = clip((req.body || {}).subject, 120).replace(/^(i want to |i'd like to |please )?(learn|study|master)\s+/i, '');
  const level = ['beginner', 'intermediate', 'advanced'].includes((req.body || {}).level) ? req.body.level : 'beginner';
  if (subject.length < 2) throw new RuleError('VALIDATION', 'What would you like to learn?', { fields: { subject: 'Enter a subject' } });
  const cfg = await getConfig();
  let road = null;
  let source = 'template';
  const text = await callAI({
    system: 'You design study roadmaps. Reply with ONLY a JSON object, no prose.',
    messages: [{ role: 'user', content: `Create a roadmap to learn "${subject}" for a ${level}. JSON shape: {"title":string,"description":string,"topics":[{"key":string,"title":string,"description":string,"hours":number,"prerequisites":[key,...]}]}. Use 8-12 topics, ordered so prerequisites come first, each with at most ${cfg.maxPrerequisitesPerTopic} prerequisites, titles under 60 characters, realistic hours.` }],
    maxTokens: 2000,
  });
  const parsed = extractJson(text);
  if (parsed) {
    try { road = Features.sanitizeRoadmap(parsed, cfg); source = 'gemini'; } catch { road = null; }
  }
  if (!road) {
    const fb = Features.fallbackRoadmap({ subject, level });
    road = Features.sanitizeRoadmap(fb, cfg);
    source = fb.source === 'template' ? 'template' : 'generic';
  }
  res.json({ roadmap: { title: road.title || subject, description: road.description || '', topics: road.topics }, source, ai: enabled() });
}));

/* ----- quiz ----- */
router.post('/topics/:id/quiz', requireAuth, aiLimit, ah(async (req, res) => {
  const { topic, siblings } = await loadTopic(req.params.id);
  assertCanRead(req.user, topic.ownerId);
  const prereqTitles = topic.prerequisites.map((id) => (siblings.find((t) => t.id === id) || {}).title).filter(Boolean);
  const text = await callAI({
    system: 'You write accurate multiple-choice quizzes. Reply with ONLY a JSON object, no prose.',
    messages: [{ role: 'user', content: `Write 5 multiple-choice questions to test understanding of "${topic.title}"${topic.description ? ` (${clip(topic.description, 200)})` : ''}. JSON shape: {"questions":[{"question":string,"options":[4 strings],"answerIndex":0-3,"explanation":string}]}. Only ask what you are certain is correct.` }],
    maxTokens: 1800,
  });
  const parsed = extractJson(text);
  let quiz = null;
  let source = 'builtin';
  if (parsed) { try { quiz = Features.sanitizeQuiz(parsed); source = 'gemini'; } catch { quiz = null; } }
  if (!quiz) quiz = Features.fallbackQuiz(topic, prereqTitles);
  res.json({ quiz, source, topic: { id: topic.id, title: topic.title } });
}));

router.post('/topics/:id/quiz/attempt', requireAuth, ah(async (req, res) => {
  const { topic } = await loadTopic(req.params.id);
  assertCanEdit(req.user, topic.ownerId);
  const score = Number((req.body || {}).score);
  const total = Number((req.body || {}).total);
  if (!Number.isInteger(score) || !Number.isInteger(total) || total < 1 || total > 20 || score < 0 || score > total) throw new RuleError('VALIDATION', 'Invalid score');
  await QuizAttempt.create({ topic: topic.id, owner: topic.ownerId, score, total });
  const attempts = await QuizAttempt.find({ topic: topic.id }).sort({ createdAt: -1 }).limit(5).lean();
  res.status(201).json({ attempts: attempts.map((a) => ({ score: a.score, total: a.total, at: a.createdAt })) });
}));

/* ----- coach ----- */
router.post('/coach', requireAuth, aiLimit, ah(async (req, res) => {
  const message = clip((req.body || {}).message, 500);
  if (!message) throw new RuleError('VALIDATION', 'Type a message');
  const learnerId = req.user.role === 'learner' ? req.user._id : (isObjectId(req.query.learnerId) ? req.query.learnerId : null);
  if (!learnerId) throw new RuleError('VALIDATION', 'The coach is for learners');
  const { learnerData } = require('./dashboard');
  const cfg = await getConfig();
  const today = Rules.todayInTz(appConfig.tz);
  const { goals, topics, sessions } = await learnerData(learnerId);
  const ctx = Features.buildCoachContext({ name: req.user.name, goals, topics, sessions, config: cfg, today });
  const history = (Array.isArray(req.body.history) ? req.body.history : []).slice(-8)
    .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').map((m) => ({ role: m.role, content: clip(m.content, 800) }));
  while (history.length && history[0].role !== 'user') history.shift();
  const text = await callAI({
    system: `You are a warm, concise study coach for ${req.user.name}. Answer using ONLY the progress facts in this JSON (never invent numbers, topics or deadlines); if asked something unrelated to studying, answer briefly. Max 120 words, no emojis.\n\n${JSON.stringify(ctx)}`,
    messages: [...history, { role: 'user', content: message }],
    maxTokens: 500,
  });
  res.json(text ? { reply: text, source: 'gemini', chips: Features.COACH_CHIPS } : { reply: Features.coachFallback(message, ctx), source: 'builtin', chips: Features.COACH_CHIPS });
}));

module.exports = router;
