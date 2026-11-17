const router = require('express').Router();
const { ah } = require('../middleware/errors');
const { requireAuth } = require('../middleware/auth');
const Rules = require('../../shared/rules');
const appConfig = require('../config');
const { getConfig } = require('../services/data');
const { callAI } = require('../services/ai');
const Features = require('../../shared/features');
const { learnerData, resolveLearner } = require('./dashboard');

router.use(requireAuth);

const cache = new Map(); // key -> { at, value }  (keeps LLM calls cheap)
const TTL = 10 * 60 * 1000;

/** Asks Gemini to write the narrative from the computed facts. Returns null on any failure so the caller can fall back. */
async function aiNarrative(review, name) {
  return callAI({
    system: `You are a warm, concise study coach. Write a 3-4 sentence weekly review for ${name}. Use ONLY the facts in the JSON (do not invent numbers or topics), mention one win and one concrete next step, and avoid emojis.`,
    messages: [{ role: 'user', content: JSON.stringify(review) }],
    maxTokens: 400,
    timeoutMs: 15000,
  });
}

router.get(
  '/insights',
  ah(async (req, res) => {
    const learner = await resolveLearner(req);
    const cfg = await getConfig();
    const today = Rules.todayInTz(appConfig.tz);
    const { topics, sessions } = await learnerData(learner._id);
    const review = Rules.buildReview({ topics, sessions, config: cfg, today });
    const plan = Rules.suggestPlan({ topics, sessions, config: cfg, today });
    const schedule = Features.suggestSchedule({ topics, sessions, config: cfg, today });

    const key = `${learner._id}|${today}|${review.minutes}|${review.sessions}|${review.completed.length}`;
    let narrative;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) narrative = hit.value;
    else {
      const ai = await aiNarrative(review, learner.name);
      narrative = ai ? { text: ai, source: 'gemini' } : { text: Rules.narrate(review, learner.name), source: 'engine' };
      cache.set(key, { at: Date.now(), value: narrative });
    }
    res.json({ learner: { id: String(learner._id), name: learner.name }, today, review, narrative, plan, schedule });
  })
);

module.exports = router;
