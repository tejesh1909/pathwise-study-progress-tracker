/* Thin Google Gemini client. Used only when GEMINI_API_KEY is set; every caller has a deterministic fallback. */
const appConfig = require('../config');

const enabled = () => !!appConfig.geminiKey;

/**
 * Returns the reply text, or null on any failure (no key, timeout, HTTP error, blocked/empty reply).
 * `messages` use { role: 'user' | 'assistant', content } and are mapped to Gemini's user/model roles.
 */
async function callAI({ system, messages, maxTokens = 1200, timeoutMs = 25000 }) {
  if (!enabled()) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const model = encodeURIComponent(appConfig.geminiModel);
    const generationConfig = { maxOutputTokens: maxTokens, temperature: 0.6 };
    // 2.5 models "think" by default and thinking tokens eat the output budget; short answers don't need it.
    if (/2\.5/.test(appConfig.geminiModel)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': appConfig.geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig,
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || '').join(' ').trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pulls the first JSON object out of a model reply (tolerates code fences / chatter). */
function extractJson(text) {
  if (!text) return null;
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

module.exports = { callAI, extractJson, enabled };
