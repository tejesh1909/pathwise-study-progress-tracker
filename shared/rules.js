/*
 * Pure domain rules for the Study Progress Tracker.
 * No I/O, no database, no DOM. Works in Node (server + tests) and the browser (offline preview).
 *
 * Everything the brief calls "core business logic" lives here:
 *   - prerequisite validation (self-reference + loop rejection, max prerequisites)
 *   - the unlock rule (a topic is locked until all prerequisites are complete)
 *   - re-locking when a topic is reopened (cascade or block, admin-configurable)
 *   - study-session validation (configurable min/max minutes, no future dates)
 *   - progress maths, streaks, weekly review and suggested study plan
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ config */

  const DEFAULT_CONFIG = Object.freeze({
    minSessionMinutes: 5,
    maxSessionMinutes: 480,
    maxPrerequisitesPerTopic: 5,
    reopenPolicy: 'cascade', // 'cascade' = reopen dependents too, 'block' = refuse while dependents are complete
    weeklyTargetMinutes: 300,
    defaultTopicMinutes: 180, // used by deadline forecasts for topics with no estimate
  });

  const GOAL_COLORS = ['violet', 'cyan', 'mint', 'amber', 'rose', 'sky'];

  class RuleError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'RuleError';
      this.code = code; // VALIDATION | LOCKED | CONFLICT | FORBIDDEN | NOT_FOUND
      this.details = details || {};
    }
  }

  const isInt = (n) => typeof n === 'number' && Number.isInteger(n);

  /** Validates admin-supplied configuration and returns a complete, normalised config object. */
  function validateConfig(input, base) {
    const merged = Object.assign({}, DEFAULT_CONFIG, base || {}, input || {});
    const fields = {};
    const num = (k) => (typeof merged[k] === 'string' && merged[k].trim() !== '' ? Number(merged[k]) : merged[k]);
    const cfg = {
      minSessionMinutes: num('minSessionMinutes'),
      maxSessionMinutes: num('maxSessionMinutes'),
      maxPrerequisitesPerTopic: num('maxPrerequisitesPerTopic'),
      reopenPolicy: merged.reopenPolicy,
      weeklyTargetMinutes: num('weeklyTargetMinutes'),
      defaultTopicMinutes: num('defaultTopicMinutes'),
    };
    if (!isInt(cfg.minSessionMinutes) || cfg.minSessionMinutes < 1 || cfg.minSessionMinutes > 1440)
      fields.minSessionMinutes = 'Whole number between 1 and 1440';
    if (!isInt(cfg.maxSessionMinutes) || cfg.maxSessionMinutes < 1 || cfg.maxSessionMinutes > 1440)
      fields.maxSessionMinutes = 'Whole number between 1 and 1440';
    if (!fields.minSessionMinutes && !fields.maxSessionMinutes && cfg.maxSessionMinutes < cfg.minSessionMinutes)
      fields.maxSessionMinutes = 'Must be at least the minimum';
    if (!isInt(cfg.maxPrerequisitesPerTopic) || cfg.maxPrerequisitesPerTopic < 0 || cfg.maxPrerequisitesPerTopic > 25)
      fields.maxPrerequisitesPerTopic = 'Whole number between 0 and 25';
    if (!['cascade', 'block'].includes(cfg.reopenPolicy)) fields.reopenPolicy = 'Must be "cascade" or "block"';
    if (!isInt(cfg.weeklyTargetMinutes) || cfg.weeklyTargetMinutes < 30 || cfg.weeklyTargetMinutes > 10080)
      fields.weeklyTargetMinutes = 'Whole number between 30 and 10080';
    if (!isInt(cfg.defaultTopicMinutes) || cfg.defaultTopicMinutes < 15 || cfg.defaultTopicMinutes > 6000)
      fields.defaultTopicMinutes = 'Whole number between 15 and 6000';
    if (Object.keys(fields).length) throw new RuleError('VALIDATION', 'Invalid settings', { fields });
    return cfg;
  }

  /* ------------------------------------------------------------------- dates */
  // All dates are plain "YYYY-MM-DD" strings; arithmetic is done in UTC days so DST never interferes.

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const toDays = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  };
  const fromDays = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
  const addDays = (s, n) => fromDays(toDays(s) + n);
  const diffDays = (a, b) => toDays(a) - toDays(b);
  const isRealDate = (s) => typeof s === 'string' && DATE_RE.test(s) && fromDays(toDays(s)) === s;

  /** Today's date in the given IANA time zone, as YYYY-MM-DD. */
  function todayInTz(tz, now) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      now || new Date()
    );
  }

  /* ----------------------------------------------------------- topic helpers */

  const sid = (x) => String(x);
  const prereqsOf = (t) => (t.prerequisites || []).map(sid);
  const indexTopics = (topics) => new Map(topics.map((t) => [sid(t.id), t]));

  /**
   * The unlock rule. Returns { [topicId]: { state, missing: [prereqIds], locked } }.
   * state: 'complete' | 'locked' | 'pending' | 'in_progress' | 'available'
   * A topic is LOCKED while any of its prerequisites is not complete. Because this is derived from
   * the current completion flags every time, reopening a prerequisite automatically re-locks dependents.
   */
  function computeStates(topics, minutesByTopic) {
    const byId = indexTopics(topics);
    const mins = minutesByTopic || {};
    const out = {};
    for (const t of topics) {
      const missing = prereqsOf(t).filter((pid) => {
        const p = byId.get(pid);
        return p && !p.complete;
      });
      let state;
      if (t.complete) state = 'complete';
      else if (missing.length) state = 'locked';
      else if (t.pending) state = 'pending'; // submitted for mentor approval; dependents stay locked
      else state = (mins[sid(t.id)] || 0) > 0 ? 'in_progress' : 'available';
      out[sid(t.id)] = { state, missing, locked: state === 'locked' };
    }
    return out;
  }

  /** Topics that list `topicId` as a direct prerequisite. */
  const directDependents = (topics, topicId) => topics.filter((t) => prereqsOf(t).includes(sid(topicId)));

  /** All topics that (transitively) depend on `topicId`. */
  function transitiveDependents(topics, topicId) {
    const seen = new Set();
    const queue = [sid(topicId)];
    while (queue.length) {
      const cur = queue.shift();
      for (const d of directDependents(topics, cur)) {
        if (!seen.has(sid(d.id))) {
          seen.add(sid(d.id));
          queue.push(sid(d.id));
        }
      }
    }
    return topics.filter((t) => seen.has(sid(t.id)));
  }

  /**
   * Would giving `topicId` the prerequisites `newPrereqs` create a loop?
   * Returns the offending path (array of ids, first === last) or null.
   */
  function findCyclePath(topics, topicId, newPrereqs) {
    const start = sid(topicId);
    const graph = new Map(topics.map((t) => [sid(t.id), prereqsOf(t)]));
    graph.set(start, newPrereqs.map(sid));
    const path = [start];
    const seen = new Set();
    const dfs = (node) => {
      for (const next of graph.get(node) || []) {
        if (next === start) {
          path.push(start);
          return true;
        }
        if (seen.has(next)) continue;
        seen.add(next);
        path.push(next);
        if (dfs(next)) return true;
        path.pop();
      }
      return false;
    };
    return dfs(start) ? path : null;
  }

  /**
   * Validates a prerequisite list for a topic. `topics` are the topics of the same goal.
   * `topicId` is null when the topic is being created (a brand-new node cannot form a loop).
   */
  function validatePrerequisites({ topics, topicId, prerequisites, config }) {
    const cfg = config || DEFAULT_CONFIG;
    const list = prerequisites == null ? [] : prerequisites;
    if (!Array.isArray(list)) throw new RuleError('VALIDATION', 'Prerequisites must be a list', { fields: { prerequisites: 'Must be a list' } });
    const ids = list.map(sid);
    const byId = indexTopics(topics);
    const fail = (msg, extra) => {
      throw new RuleError('VALIDATION', msg, Object.assign({ fields: { prerequisites: msg } }, extra));
    };
    if (new Set(ids).size !== ids.length) fail('Duplicate prerequisites are not allowed', { reason: 'duplicate' });
    if (topicId != null && ids.includes(sid(topicId))) fail('A topic cannot be its own prerequisite', { reason: 'self' });
    for (const id of ids) if (!byId.has(id)) fail('Every prerequisite must be a topic in the same goal', { reason: 'unknown' });
    if (ids.length > cfg.maxPrerequisitesPerTopic)
      fail(`A topic can have at most ${cfg.maxPrerequisitesPerTopic} prerequisite${cfg.maxPrerequisitesPerTopic === 1 ? '' : 's'}`, {
        reason: 'max',
        max: cfg.maxPrerequisitesPerTopic,
      });
    if (topicId != null) {
      const cycle = findCyclePath(topics, topicId, ids);
      if (cycle) {
        const names = cycle.map((id) => (byId.get(id) ? byId.get(id).title : id));
        fail(`That would create a loop: ${names.join(' → ')}`, { reason: 'cycle', path: cycle });
      }
    }
    return ids;
  }

  /**
   * Can this topic be marked complete? Throws LOCKED (with the missing prerequisites) if not.
   * With opts.needsApproval (mentor-assigned goals) the learner can only SUBMIT it: it becomes `pending`
   * and keeps its dependents locked until a mentor approves.
   */
  function planComplete(topics, topicId, opts) {
    const byId = indexTopics(topics);
    const t = byId.get(sid(topicId));
    if (!t) throw new RuleError('NOT_FOUND', 'Topic not found');
    if (t.complete) return { changed: [], pending: false };
    const needsApproval = !!(opts && opts.needsApproval);
    const st = computeStates(topics)[sid(t.id)];
    if (st.locked) {
      const missing = st.missing.map((id) => ({ id, title: byId.get(id).title }));
      throw new RuleError('LOCKED', `Locked — finish ${missing.map((m) => m.title).join(', ')} first`, { missing });
    }
    if (t.pending && needsApproval) return { changed: [], pending: true }; // already submitted
    return { changed: [sid(t.id)], pending: needsApproval };
  }

  function assertPending(topics, topicId) {
    const byId = indexTopics(topics);
    const t = byId.get(sid(topicId));
    if (!t) throw new RuleError('NOT_FOUND', 'Topic not found');
    if (t.complete) throw new RuleError('CONFLICT', 'This topic is already approved');
    if (!t.pending) throw new RuleError('CONFLICT', "Nothing to review — the learner hasn't submitted this topic");
    if (computeStates(topics)[sid(t.id)].locked) throw new RuleError('LOCKED', 'This topic is locked again — a prerequisite was reopened');
    return t;
  }
  /** Mentor approves a submitted topic: it becomes complete (and unlocks dependents). */
  function planApprove(topics, topicId) {
    return { changed: [sid(assertPending(topics, topicId).id)] };
  }
  /** Mentor sends a submitted topic back to the learner. */
  function planReject(topics, topicId) {
    return { changed: [sid(assertPending(topics, topicId).id)] };
  }

  /**
   * Reopening a topic re-locks everything that depends on it.
   * policy 'cascade': completed dependents are reopened too (so the invariant "complete ⇒ prerequisites complete" holds).
   * policy 'block'  : refuse while any dependent is complete.
   */
  function planReopen(topics, topicId, config) {
    const cfg = config || DEFAULT_CONFIG;
    const byId = indexTopics(topics);
    const t = byId.get(sid(topicId));
    if (!t) throw new RuleError('NOT_FOUND', 'Topic not found');
    if (!t.complete) return t.pending ? { reopened: [sid(t.id)], relocked: [] } : { reopened: [], relocked: [] }; // withdraw a submission
    const deps = transitiveDependents(topics, t.id);
    const completeDeps = deps.filter((d) => d.complete);
    const pendingDeps = deps.filter((d) => d.pending && !d.complete);
    if (cfg.reopenPolicy === 'block' && completeDeps.length) {
      throw new RuleError('CONFLICT', `Can't reopen — ${completeDeps.map((d) => d.title).join(', ')} already depend on it`, {
        blockedBy: completeDeps.map((d) => ({ id: sid(d.id), title: d.title })),
      });
    }
    return {
      reopened: [sid(t.id), ...completeDeps.map((d) => sid(d.id)), ...pendingDeps.map((d) => sid(d.id))],
      relocked: deps.map((d) => ({ id: sid(d.id), title: d.title })),
    };
  }

  /* ---------------------------------------------------------------- sessions */

  /** Validates a study session and returns the normalised values. */
  function validateSession({ input, topic, state, config, today }) {
    const cfg = config || DEFAULT_CONFIG;
    const fields = {};
    const i = input || {};
    const minutes = typeof i.minutes === 'string' && i.minutes.trim() !== '' ? Number(i.minutes) : i.minutes;
    const note = i.note == null ? '' : String(i.note).trim();
    if (!isRealDate(i.date)) fields.date = 'Pick a valid date';
    else if (today && i.date > today) fields.date = "Date can't be in the future";
    if (!isInt(minutes)) fields.minutes = 'Enter whole minutes';
    else if (minutes < cfg.minSessionMinutes || minutes > cfg.maxSessionMinutes)
      fields.minutes = `Minutes must be between ${cfg.minSessionMinutes} and ${cfg.maxSessionMinutes}`;
    if (note.length > 500) fields.note = 'Keep the note under 500 characters';
    const time = i.time == null ? '' : String(i.time).trim();
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fields.time = 'Use a time like 19:30';
    if (!topic) fields.topic = 'Choose a topic';
    if (Object.keys(fields).length) throw new RuleError('VALIDATION', 'Please fix the highlighted fields', { fields });
    if (state && state.locked) {
      throw new RuleError('LOCKED', 'This topic is still locked', { missing: state.missing });
    }
    return { date: i.date, minutes, note, time };
  }

  function validateGoalInput(input) {
    const fields = {};
    const title = String((input && input.title) || '').trim();
    const description = String((input && input.description) || '').trim();
    const color = (input && input.color) || 'violet';
    const targetDate = input && input.targetDate ? String(input.targetDate) : '';
    if (!title || title.length > 80) fields.title = 'Title is required (max 80 characters)';
    if (description.length > 500) fields.description = 'Max 500 characters';
    if (!GOAL_COLORS.includes(color)) fields.color = 'Unknown colour';
    if (targetDate && !isRealDate(targetDate)) fields.targetDate = 'Pick a valid date';
    if (Object.keys(fields).length) throw new RuleError('VALIDATION', 'Please fix the highlighted fields', { fields });
    return { title, description, color, targetDate };
  }

  /** Resource links: http(s) only (blocks javascript:, data: etc.), max 10, titles default to the host name. */
  function normalizeResources(list) {
    if (list == null || list === '') return [];
    const bad = (msg) => { throw new RuleError('VALIDATION', msg, { fields: { resources: msg } }); };
    if (!Array.isArray(list)) bad('Resources must be a list');
    if (list.length > 10) bad('Add at most 10 links');
    return list.map((r) => {
      const raw = String((r && r.url) || '').trim();
      let u;
      try { u = new URL(raw); } catch { bad(`"${raw.slice(0, 40)}" is not a valid link`); }
      if (!['http:', 'https:'].includes(u.protocol)) bad('Links must start with http:// or https://');
      if (raw.length > 300) bad('A link is too long (max 300 characters)');
      const title = String((r && r.title) || '').trim().slice(0, 80) || u.hostname.replace(/^www\./, '');
      return { title, url: u.href };
    });
  }

  function validateTopicInput(input) {
    const fields = {};
    const i = input || {};
    const title = String(i.title || '').trim();
    const description = String(i.description || '').trim();
    const notes = String(i.notes || '').trim();
    let est = i.estimateMinutes;
    if (est === undefined || est === null || est === '') est = 0;
    if (typeof est === 'string') est = Number(est);
    if (!title || title.length > 80) fields.title = 'Title is required (max 80 characters)';
    if (description.length > 500) fields.description = 'Max 500 characters';
    if (notes.length > 2000) fields.notes = 'Keep notes under 2000 characters';
    if (!isInt(est) || est < 0 || est > 36000) fields.estimateMinutes = 'Whole minutes between 0 and 36000 (600 hours)';
    let resources = [];
    try { resources = normalizeResources(i.resources); } catch (e) { fields.resources = (e.details && e.details.fields && e.details.fields.resources) || e.message; }
    if (Object.keys(fields).length) throw new RuleError('VALIDATION', 'Please fix the highlighted fields', { fields });
    return { title, description, notes, estimateMinutes: est, resources };
  }

  /* ---------------------------------------------------------------- progress */

  function minutesByTopic(sessions) {
    const out = {};
    for (const s of sessions) out[sid(s.topicId)] = (out[sid(s.topicId)] || 0) + s.minutes;
    return out;
  }

  /** Per-goal progress: percent of topics complete, total minutes, minutes per topic. */
  function goalProgress(topics, sessions) {
    const total = topics.length;
    const done = topics.filter((t) => t.complete).length;
    const mins = minutesByTopic(sessions);
    return {
      totalTopics: total,
      completeTopics: done,
      percent: total ? Math.round((done / total) * 100) : 0,
      totalMinutes: sessions.reduce((a, s) => a + s.minutes, 0),
      minutesByTopic: mins,
    };
  }

  /** Six rolling 7-day buckets ending today (oldest first). */
  function weeklySeries(sessions, today, weeks) {
    const n = weeks || 6;
    const buckets = [];
    for (let i = n - 1; i >= 0; i--) {
      const end = addDays(today, -7 * i);
      buckets.push({ start: addDays(end, -6), end, minutes: 0, sessions: 0 });
    }
    for (const s of sessions) {
      const b = buckets.find((x) => s.date >= x.start && s.date <= x.end);
      if (b) {
        b.minutes += s.minutes;
        b.sessions += 1;
      }
    }
    return buckets;
  }

  /** Minutes per day for the last `days` days (oldest first). */
  function heatmap(sessions, today, days) {
    const n = days || 42;
    const by = {};
    for (const s of sessions) by[s.date] = (by[s.date] || 0) + s.minutes;
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      out.push({ date: d, minutes: by[d] || 0 });
    }
    return out;
  }

  /** Consecutive study days ending today (or yesterday, so an unfinished day doesn't break a streak). */
  function streak(sessions, today) {
    const days = new Set(sessions.map((s) => s.date));
    let d = days.has(today) ? today : addDays(today, -1);
    let n = 0;
    while (days.has(d)) {
      n++;
      d = addDays(d, -1);
    }
    return n;
  }

  /* ---------------------------------------------------------------- insights */

  function lastStudied(sessions) {
    const out = {};
    for (const s of sessions) if (!out[sid(s.topicId)] || s.date > out[sid(s.topicId)]) out[sid(s.topicId)] = s.date;
    return out;
  }

  /** Deterministic weekly review: everything needed to write (or have an AI write) the narrative. */
  function buildReview({ topics, sessions, config, today }) {
    const cfg = config || DEFAULT_CONFIG;
    const from = addDays(today, -6);
    const prevFrom = addDays(today, -13);
    const prevTo = addDays(today, -7);
    const cur = sessions.filter((s) => s.date >= from && s.date <= today);
    const prev = sessions.filter((s) => s.date >= prevFrom && s.date <= prevTo);
    const minutes = cur.reduce((a, s) => a + s.minutes, 0);
    const previousMinutes = prev.reduce((a, s) => a + s.minutes, 0);
    const byId = indexTopics(topics);
    const perTopic = minutesByTopic(cur);
    const topTopics = Object.entries(perTopic)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, m]) => ({ id, title: byId.get(id) ? byId.get(id).title : 'Removed topic', minutes: m }));
    const completed = topics.filter((t) => t.complete && t.completedOn && t.completedOn >= from && t.completedOn <= today).map((t) => t.title);
    const states = computeStates(topics, minutesByTopic(sessions));
    const last = lastStudied(sessions);
    const stalled = topics
      .filter((t) => states[sid(t.id)].state === 'in_progress' && last[sid(t.id)] && diffDays(today, last[sid(t.id)]) >= 7)
      .map((t) => ({ title: t.title, daysSince: diffDays(today, last[sid(t.id)]) }));
    const unlocked = topics.filter((t) => states[sid(t.id)].state === 'available').map((t) => t.title);
    const deltaPercent = previousMinutes ? Math.round(((minutes - previousMinutes) / previousMinutes) * 100) : null;
    return {
      period: { from, to: today },
      minutes,
      previousMinutes,
      deltaPercent,
      sessions: cur.length,
      activeDays: new Set(cur.map((s) => s.date)).size,
      targetMinutes: cfg.weeklyTargetMinutes,
      targetPercent: Math.round((minutes / cfg.weeklyTargetMinutes) * 100),
      streak: streak(sessions, today),
      topTopics,
      completed,
      stalled,
      readyToStart: unlocked,
    };
  }

  const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`);

  /** Template narrative used when no LLM is configured. Honest and deterministic. */
  function narrate(r, name) {
    const who = name ? name.split(' ')[0] : 'You';
    const lines = [];
    if (!r.sessions) {
      lines.push(`${who === 'You' ? 'You' : who} didn't log any study time in the last 7 days. A single 25-minute session today is enough to restart the streak.`);
    } else {
      let l = `${who === 'You' ? 'You' : who} studied ${fmtMin(r.minutes)} across ${r.sessions} session${r.sessions === 1 ? '' : 's'} on ${r.activeDays} day${r.activeDays === 1 ? '' : 's'} — ${r.targetPercent}% of the ${fmtMin(r.targetMinutes)} weekly target`;
      if (r.deltaPercent != null) l += `, ${r.deltaPercent >= 0 ? 'up' : 'down'} ${Math.abs(r.deltaPercent)}% on the previous week`;
      lines.push(l + '.');
    }
    if (r.completed.length) lines.push(`Finished: ${r.completed.join(', ')}.`);
    if (r.topTopics.length) lines.push(`Most time went into ${r.topTopics[0].title} (${fmtMin(r.topTopics[0].minutes)}).`);
    if (r.stalled.length) lines.push(`${r.stalled[0].title} has gone quiet for ${r.stalled[0].daysSince} days — worth a short revisit.`);
    if (r.streak >= 3) lines.push(`You're on a ${r.streak}-day streak. Keep it alive.`);
    return lines.join(' ');
  }

  /**
   * Suggested study plan for the next 7 days. Only unlocked topics are ever suggested.
   * Priority: topics already in progress, then topics that unlock the most dependents, then the least recently studied.
   */
  function suggestPlan({ topics, sessions, config, today, maxItems }) {
    const cfg = config || DEFAULT_CONFIG;
    const states = computeStates(topics, minutesByTopic(sessions));
    const last = lastStudied(sessions);
    const candidates = topics
      .filter((t) => ['available', 'in_progress'].includes(states[sid(t.id)].state))
      .map((t) => {
        const deps = directDependents(topics, t.id);
        // dependents that would become unlocked the moment this topic is completed
        const unlocks = deps.filter((d) => {
          if (d.complete) return false;
          const others = prereqsOf(d).filter((p) => p !== sid(t.id));
          return others.every((p) => (topics.find((x) => sid(x.id) === p) || {}).complete);
        });
        const since = last[sid(t.id)] ? Math.min(diffDays(today, last[sid(t.id)]), 14) : 14;
        const inProg = states[sid(t.id)].state === 'in_progress';
        return { t, unlocks, inProg, since, score: (inProg ? 100 : 0) + unlocks.length * 10 + deps.length + since / 14 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems || 4);
    if (!candidates.length) return { targetMinutes: cfg.weeklyTargetMinutes, items: [] };
    const each = Math.round(cfg.weeklyTargetMinutes / candidates.length / 5) * 5;
    const clamp = (m) => Math.max(cfg.minSessionMinutes, Math.min(cfg.maxSessionMinutes, m));
    const items = candidates.map((c, idx) => {
      let reason;
      if (c.inProg && c.unlocks.length) reason = `Already underway, and finishing it unlocks ${c.unlocks.map((u) => u.title).join(', ')}.`;
      else if (c.inProg) reason = last[sid(c.t.id)] ? `Already underway — last studied ${diffDays(today, last[sid(c.t.id)])} days ago.` : 'Already underway.';
      else if (c.unlocks.length) reason = `Ready to start, and it unlocks ${c.unlocks.map((u) => u.title).join(', ')}.`;
      else reason = 'Unlocked and ready to start.';
      return {
        topicId: sid(c.t.id),
        goalId: c.t.goalId != null ? sid(c.t.goalId) : null,
        title: c.t.title,
        state: states[sid(c.t.id)].state,
        minutes: clamp(idx === 0 ? cfg.weeklyTargetMinutes - each * (candidates.length - 1) : each),
        unlocks: c.unlocks.map((u) => u.title),
        reason,
      };
    });
    return { targetMinutes: cfg.weeklyTargetMinutes, items };
  }

  return {
    DEFAULT_CONFIG,
    GOAL_COLORS,
    RuleError,
    validateConfig,
    todayInTz,
    isRealDate,
    addDays,
    diffDays,
    computeStates,
    directDependents,
    transitiveDependents,
    findCyclePath,
    validatePrerequisites,
    planComplete,
    planApprove,
    planReject,
    planReopen,
    normalizeResources,
    validateSession,
    validateGoalInput,
    validateTopicInput,
    minutesByTopic,
    goalProgress,
    weeklySeries,
    heatmap,
    streak,
    buildReview,
    narrate,
    suggestPlan,
  };
});
