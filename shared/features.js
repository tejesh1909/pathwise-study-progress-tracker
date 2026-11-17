/*
 * Feature logic that sits on top of shared/rules.js. Pure functions, no I/O, usable in Node and in the browser preview.
 *   - goalForecast        deadline forecast from estimates + recent pace
 *   - habits / suggestSchedule   "smarter plans": when you actually study, turned into a 7-day schedule
 *   - roadmap             sanitise (AI or template) roadmaps: loop-free, topologically ordered, limits enforced
 *   - quiz                sanitise generated quizzes, plus a no-AI self-check fallback
 *   - coach               progress context + a rule-based fallback coach
 *   - CSV                 export with spreadsheet-formula injection protection
 * Anything that can come from an AI model is validated here before it is trusted.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules'));
  else root.Features = factory(root.Rules);
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';
  const { RuleError } = R;

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtMin = (m) => {
    m = Math.round(m || 0);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  };
  const fmtDate = (s) => {
    const [, m, d] = s.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]}`;
  };
  const weekdayOf = (d) => {
    const [y, m, dd] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  /* ============================================================ deadline forecast */

  /**
   * Will this goal be finished by its target date?
   *   remaining work = Σ over unfinished topics of (estimate − minutes already logged); topics without an estimate use the
   *   average of the goal's estimated topics (or the configured default) and are counted in `assumedTopics`.
   *   pace = minutes logged for this goal in the last 28 days ÷ 4.
   * status: done | empty | no_target | on_track | at_risk (≤14 days late) | behind | stalled (no recent study) | overdue
   */
  function goalForecast({ goal, topics, sessions, config, today }) {
    const cfg = config || R.DEFAULT_CONFIG;
    const target = (goal && goal.targetDate) || '';
    const logged = R.minutesByTopic(sessions);
    const known = topics.filter((t) => t.estimateMinutes > 0);
    const avgKnown = known.length ? Math.round(known.reduce((a, t) => a + t.estimateMinutes, 0) / known.length) : cfg.defaultTopicMinutes;
    const est = (t) => (t.estimateMinutes > 0 ? t.estimateMinutes : avgKnown);
    const open = topics.filter((t) => !t.complete);
    const remaining = open.reduce((a, t) => a + (t.pending ? 0 : Math.max(0, est(t) - (logged[String(t.id)] || 0))), 0);
    const since = R.addDays(today, -27);
    const recent = sessions.filter((s) => s.date >= since && s.date <= today).reduce((a, s) => a + s.minutes, 0);
    const pace = Math.round(recent / 4);
    const out = {
      targetDate: target,
      remainingMinutes: remaining,
      totalEstimateMinutes: topics.reduce((a, t) => a + est(t), 0),
      loggedMinutes: sessions.reduce((a, s) => a + s.minutes, 0),
      assumedTopics: open.filter((t) => !(t.estimateMinutes > 0)).length,
      paceMinutesPerWeek: pace,
      projectedDate: null,
      slackDays: null,
      requiredMinutesPerWeek: null,
    };
    if (!topics.length) return { ...out, status: 'empty', headline: 'Add topics to get a forecast.' };
    if (!open.length) return { ...out, status: 'done', headline: 'Goal complete.' };

    const projected = remaining === 0 ? today : pace > 0 ? R.addDays(today, Math.ceil((remaining / pace) * 7)) : null;
    out.projectedDate = projected;
    const daysLeft = target ? R.diffDays(target, today) : null;
    if (target && daysLeft > 0) out.requiredMinutesPerWeek = Math.ceil(remaining / (daysLeft / 7));
    out.slackDays = target && projected ? R.diffDays(target, projected) : null;

    const left = fmtMin(remaining);
    const need = out.requiredMinutesPerWeek ? fmtMin(out.requiredMinutesPerWeek) + '/week' : '';
    let status, headline;
    if (!target) {
      status = 'no_target';
      headline = projected ? `About ${left} left — around ${fmtDate(projected)} at your current pace. Set a target date to track it.` : `About ${left} left. Log a few sessions to see a projected finish.`;
    } else if (daysLeft <= 0) {
      status = 'overdue';
      headline = daysLeft === 0 ? `Target is today and ${left} of work is still open.` : `Target date passed ${plural(-daysLeft, 'day')} ago with ${left} still to go.`;
    } else if (remaining === 0) {
      status = 'on_track';
      headline = 'All the study time is in — mark the remaining topics complete.';
    } else if (pace === 0) {
      status = 'stalled';
      headline = `Nothing logged in the last 4 weeks. ${left} left — about ${need} would still make ${fmtDate(target)}.`;
    } else if (out.slackDays >= 0) {
      status = 'on_track';
      headline = out.slackDays === 0 ? `On pace to finish on ${fmtDate(target)}, right on your target.` : `On pace to finish ${fmtDate(projected)}, ${plural(out.slackDays, 'day')} before your ${fmtDate(target)} target.`;
    } else if (out.slackDays >= -14) {
      status = 'at_risk';
      headline = `At this pace you'd finish ${fmtDate(projected)}, ${plural(-out.slackDays, 'day')} after your ${fmtDate(target)} target. About ${need} gets you there.`;
    } else {
      status = 'behind';
      headline = `At this pace you'd finish ${fmtDate(projected)}, ${plural(-out.slackDays, 'day')} after your ${fmtDate(target)} target. You'd need about ${need} (now ${fmtMin(pace)}/week).`;
    }
    return { ...out, status, headline };
  }
  const WARNING_STATUSES = ['at_risk', 'behind', 'stalled', 'overdue'];

  /* ============================================================ habits + smart schedule */

  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const toHHMM = (mins) => {
    const m = (Math.round(mins / 15) * 15) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };
  const partOfDay = (hhmm) => { const h = Number(hhmm.slice(0, 2)); return h < 5 ? 'late night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night'; };

  /** What the last 8 weeks say about when this learner really studies. */
  function habits(sessions, today) {
    const from = R.addDays(today, -55);
    const recent = sessions.filter((s) => s.date >= from && s.date <= today);
    const days = new Set(recent.map((s) => s.date));
    const base = { enough: false, studyDaysPerWeek: null, preferredWeekdays: [], startWeekday: '18:30', startWeekend: '10:00', typicalMinutes: 45, bestDay: null, partOfDay: 'evening', minutesByWeekday: Array(7).fill(0), timedSessions: 0 };
    if (recent.length < 4 || days.size < 3) return base;
    const perDow = Array(7).fill(0);
    days.forEach((d) => perDow[weekdayOf(d)]++);
    const minutesByWeekday = Array(7).fill(0);
    recent.forEach((s) => (minutesByWeekday[weekdayOf(s.date)] += s.minutes));
    const maxC = Math.max(...perDow);
    const preferred = perDow
      .map((c, i) => [c, i])
      .filter(([c]) => c >= Math.max(1, Math.ceil(maxC * 0.5)))
      .sort((a, b) => b[0] - a[0] || a[1] - b[1])
      .slice(0, 4)
      .map((x) => x[1])
      .sort((a, b) => a - b);
    const timed = recent.filter((s) => s.time);
    const wkd = timed.filter((s) => ![0, 6].includes(weekdayOf(s.date))).map((s) => toMin(s.time));
    const wke = timed.filter((s) => [0, 6].includes(weekdayOf(s.date))).map((s) => toMin(s.time));
    const all = timed.map((s) => toMin(s.time));
    const overall = median(all);
    const startWeekday = toHHMM(median(wkd) ?? overall ?? 18.5 * 60);
    const startWeekend = toHHMM(median(wke) ?? overall ?? 10 * 60);
    const typical = Math.round(median(recent.map((s) => s.minutes)) / 5) * 5;
    return {
      enough: true,
      studyDaysPerWeek: Math.round((days.size / 8) * 10) / 10,
      preferredWeekdays: preferred,
      startWeekday,
      startWeekend,
      typicalMinutes: Math.max(15, typical),
      bestDay: DAYS[perDow.indexOf(maxC)],
      partOfDay: partOfDay(overall != null ? toHHMM(overall) : '18:30'),
      minutesByWeekday,
      timedSessions: timed.length,
    };
  }

  /**
   * A 7-day schedule built from the weekly plan and the learner's own habits: study on the weekdays they usually study,
   * at their usual start time, in sessions about as long as their usual session. Only unlocked topics are ever scheduled.
   */
  function suggestSchedule({ topics, sessions, config, today }) {
    const cfg = config || R.DEFAULT_CONFIG;
    const plan = R.suggestPlan({ topics, sessions, config: cfg, today, maxItems: 4 });
    const hab = habits(sessions, today);
    const basis = hab.enough ? 'habits' : 'defaults';
    if (!plan.items.length) return { habits: hab, slots: [], targetMinutes: plan.targetMinutes, basis };
    const clamp = (m) => Math.max(cfg.minSessionMinutes, Math.min(cfg.maxSessionMinutes, m));
    const typical = clamp(hab.typicalMinutes);
    const need = Math.max(1, Math.min(7, Math.round(plan.targetMinutes / typical)));
    const week = Array.from({ length: 7 }, (_, i) => { const date = R.addDays(today, i); return { date, dow: weekdayOf(date) }; });
    const preferredDows = hab.enough ? hab.preferredWeekdays : [1, 3, 5, 6];
    let chosen = week.filter((w) => preferredDows.includes(w.dow)).slice(0, need);
    if (chosen.length < need) {
      const rest = week.filter((w) => !chosen.includes(w)).sort((a, b) => hab.minutesByWeekday[b.dow] - hab.minutesByWeekday[a.dow] || (a.date < b.date ? -1 : 1));
      chosen = chosen.concat(rest.slice(0, need - chosen.length));
    }
    chosen.sort((a, b) => (a.date < b.date ? -1 : 1));
    const perSlot = clamp(Math.round(plan.targetMinutes / chosen.length / 5) * 5);
    const left = Object.fromEntries(plan.items.map((i) => [i.topicId, i.minutes]));
    const slots = chosen.map((w) => {
      const pick = plan.items.slice().sort((a, b) => left[b.topicId] - left[a.topicId] || plan.items.indexOf(a) - plan.items.indexOf(b))[0];
      left[pick.topicId] -= perSlot;
      const weekend = [0, 6].includes(w.dow);
      return { date: w.date, weekday: DAYS[w.dow], time: weekend ? hab.startWeekend : hab.startWeekday, minutes: perSlot, topicId: pick.topicId, goalId: pick.goalId, title: pick.title, reason: pick.reason };
    });
    return { habits: hab, slots, targetMinutes: plan.targetMinutes, basis };
  }

  /* ============================================================ roadmaps */

  // [title, hours, [prerequisite indices]] — used when no AI key is configured.
  const TEMPLATES = [
    { match: /\brust\b/i, name: 'Rust', description: 'From cargo basics to ownership, traits and a finished CLI tool.', topics: [
      ['Tooling: rustup, Cargo and project layout', 3, []], ['Syntax, types and control flow', 6, [0]], ['Ownership and borrowing', 10, [1]],
      ['Structs, enums and pattern matching', 8, [1]], ['Error handling with Result and Option', 6, [2, 3]], ['Collections, iterators and closures', 8, [3]],
      ['Traits and generics', 10, [4, 5]], ['Lifetimes', 8, [2, 6]], ['Concurrency and async basics', 10, [6, 7]], ['Capstone: build a CLI tool', 15, [4, 8]] ] },
    { match: /\bpython\b/i, name: 'Python', description: 'Core Python, then the standard toolkit and a real project.', topics: [
      ['Setup, syntax and basic types', 4, []], ['Control flow and functions', 5, [0]], ['Lists, dicts, sets and tuples', 6, [1]],
      ['Files, errors and modules', 5, [1]], ['Object-oriented Python', 8, [2, 3]], ['Virtual environments and packages', 3, [3]],
      ['Testing with pytest', 5, [4]], ['Working with APIs and data', 8, [4, 5]], ['Capstone project', 14, [6, 7]] ] },
    { match: /(javascript|web dev|frontend|front-end|full.?stack|html|css|node|react)/i, name: 'Web development', description: 'HTML, CSS and JavaScript through to a deployed full-stack app.', topics: [
      ['HTML and semantic markup', 4, []], ['CSS layout and responsive design', 8, [0]], ['JavaScript fundamentals', 10, [0]],
      ['The DOM and events', 6, [2]], ['Async JavaScript and fetch', 6, [3]], ['Node and Express', 8, [2]], ['Databases and data modelling', 8, [5]],
      ['Authentication and security', 8, [5, 6]], ['Deploy a full-stack project', 12, [1, 4, 7]] ] },
    { match: /(sql|database|postgres|mysql)/i, name: 'SQL and databases', description: 'Query fluently, design schemas and make them fast.', topics: [
      ['SELECT, filtering and sorting', 4, []], ['Joins', 5, [0]], ['Aggregation and GROUP BY', 5, [0]], ['Subqueries and CTEs', 6, [1, 2]],
      ['Schema design and normalisation', 6, [1]], ['Indexes and query plans', 6, [4]], ['Transactions and isolation', 5, [4]], ['Window functions', 6, [3]], ['Project: design and query a real dataset', 12, [5, 6, 7]] ] },
    { match: /(data structures|dsa|algorithms|leetcode|coding interview)/i, name: 'Data structures and algorithms', description: 'Complexity, core structures and the patterns interviews test.', topics: [
      ['Big-O and complexity', 3, []], ['Arrays and strings', 6, [0]], ['Hash maps and sets', 5, [1]], ['Linked lists, stacks and queues', 7, [1]],
      ['Recursion and backtracking', 6, [3]], ['Trees and graphs', 10, [3, 4]], ['Sorting and searching', 6, [1]], ['Dynamic programming', 12, [4, 6]], ['Mock interviews and review', 10, [5, 7]] ] },
    { match: /(machine learning|\bml\b|deep learning|data science|\bai\b)/i, name: 'Machine learning', description: 'Math and Python foundations through to evaluated, explainable models.', topics: [
      ['Python, NumPy and pandas', 8, []], ['Probability and statistics', 8, []], ['Linear and logistic regression', 8, [0, 1]], ['Trees and ensembles', 8, [2]],
      ['Model evaluation and validation', 6, [2]], ['Feature engineering', 6, [0, 4]], ['Neural network basics', 10, [2]], ['Explainability and error analysis', 5, [3, 4]], ['Capstone: an end-to-end model', 15, [5, 6, 7]] ] },
    { match: /(devops|cloud|docker|kubernetes|aws|azure|gcp)/i, name: 'Cloud and DevOps', description: 'Linux, containers, pipelines and running things in the cloud.', topics: [
      ['Linux and the shell', 6, []], ['Git and collaboration', 4, []], ['Networking essentials', 5, [0]], ['Docker and containers', 8, [0]], ['CI/CD pipelines', 7, [1, 3]],
      ['Cloud compute, storage and IAM', 8, [2]], ['Infrastructure as code', 8, [5]], ['Kubernetes basics', 10, [3, 5]], ['Monitoring and incident basics', 6, [4, 7]] ] },
    { match: /(marketing|seo|brand|growth)/i, name: 'Digital marketing', description: 'Strategy, channels and measurement for a campaign you can run.', topics: [
      ['Marketing fundamentals', 4, []], ['Audience and market research', 5, [0]], ['Positioning and messaging', 4, [1]], ['Content and SEO', 8, [2]], ['Social media', 6, [2]],
      ['Email and lifecycle marketing', 5, [2]], ['Paid advertising', 6, [3, 4]], ['Analytics and reporting', 6, [3, 5]], ['Capstone: plan and launch a campaign', 12, [6, 7]] ] },
  ];
  const LEVEL = { beginner: 1, intermediate: 0.75, advanced: 0.6 };

  const subjectFrom = (text) => String(text || '').replace(/^\s*(i want to\s+)?(learn|master|study|understand|get good at|become (a|an)?|get into)\s+/i, '').replace(/[.!?]+$/, '').trim() || 'this subject';
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /** Offline roadmap: a curated template when the subject matches one, otherwise a generic learning arc. */
  function fallbackRoadmap({ subject, level }) {
    const subj = subjectFrom(subject);
    const mult = LEVEL[level] || 1;
    const tpl = TEMPLATES.find((t) => t.match.test(subj));
    let rows, title, description, source;
    if (tpl) {
      rows = tpl.topics;
      title = `Learn ${tpl.name}`;
      description = tpl.description;
      source = 'template';
    } else {
      const S = cap(subj);
      rows = [
        [`${S}: foundations and vocabulary`, 3, []], [`${S}: core concepts`, 6, [0]], [`${S}: tools and workflow`, 4, [0]], [`Hands-on basics in ${subj}`, 6, [1, 2]],
        [`Intermediate techniques in ${subj}`, 8, [3]], [`Common pitfalls and best practices`, 4, [3]], [`A practice project in ${subj}`, 10, [4, 5]], [`Advanced topics in ${subj}`, 8, [4]], [`Capstone: show what you can do with ${subj}`, 12, [6, 7]],
      ];
      title = `Learn ${subj}`;
      description = `A general learning path for ${subj}. Rename and reshape the topics to fit exactly what you need.`;
      source = 'generic';
    }
    const topics = rows.map(([t, h, p], i) => ({ key: `t${i + 1}`, title: t, description: '', estimateMinutes: Math.max(30, Math.round((h * 60 * mult) / 15) * 15), prerequisites: p.map((x) => `t${x + 1}`) }));
    return { title: title.slice(0, 80), description, topics, source };
  }

  /**
   * Validates a roadmap no matter where it came from (AI, template, or the editor): drops unknown/self/duplicate prerequisites,
   * enforces the configured prerequisite limit, removes any edge that would close a loop, clamps estimates, and returns the
   * topics ordered so every prerequisite comes before its dependents.
   */
  function sanitizeRoadmap(raw, config) {
    const cfg = config || R.DEFAULT_CONFIG;
    const list = Array.isArray(raw && raw.topics) ? raw.topics : [];
    const used = new Set();
    const topics = [];
    list.slice(0, 24).forEach((t, i) => {
      const title = String((t && t.title) || '').trim().slice(0, 80);
      if (!title) return;
      let key = String(t.key != null ? t.key : `t${i + 1}`).trim().slice(0, 40) || `t${i + 1}`;
      if (used.has(key)) key = `${key}_${i}`;
      used.add(key);
      let minutes = Number(t.estimateMinutes != null ? t.estimateMinutes : t.hours != null ? t.hours * 60 : 0);
      minutes = Number.isFinite(minutes) ? Math.min(6000, Math.max(0, Math.round(minutes / 5) * 5)) : 0;
      topics.push({ key, title, description: String(t.description || '').trim().slice(0, 300), estimateMinutes: minutes, prerequisites: Array.isArray(t.prerequisites) ? t.prerequisites.map(String) : [] });
    });
    if (topics.length < 2) throw new RuleError('VALIDATION', 'A roadmap needs at least two topics', { fields: { topics: 'Add at least two topics' } });
    const keys = new Set(topics.map((t) => t.key));
    const graph = topics.map((t) => ({ id: t.key, title: t.title, prerequisites: [] }));
    const node = new Map(graph.map((g) => [g.id, g]));
    topics.forEach((t) => {
      const kept = [];
      for (const p of [...new Set(t.prerequisites)]) {
        if (p === t.key || !keys.has(p)) continue;
        if (kept.length >= cfg.maxPrerequisitesPerTopic) break;
        if (R.findCyclePath(graph, t.key, [...kept, p])) continue; // would close a loop — drop this edge
        kept.push(p);
        node.get(t.key).prerequisites = kept.slice();
      }
      t.prerequisites = kept;
    });
    const ordered = [];
    const placed = new Set();
    let rest = topics.slice();
    while (rest.length) {
      const next = rest.filter((t) => t.prerequisites.every((p) => placed.has(p)));
      if (!next.length) break; // unreachable: loops were removed above
      next.forEach((t) => { ordered.push(t); placed.add(t.key); });
      rest = rest.filter((t) => !placed.has(t.key));
    }
    return { title: String((raw && raw.title) || '').trim().slice(0, 80), description: String((raw && raw.description) || '').trim().slice(0, 500), topics: ordered };
  }

  /* ============================================================ quizzes */

  /** Keeps only well-formed multiple-choice questions (4+ valid ones needed to be useful, at least 3). */
  function sanitizeQuiz(raw) {
    const qs = (Array.isArray(raw && raw.questions) ? raw.questions : [])
      .map((q) => {
        const options = (Array.isArray(q && q.options) ? q.options : []).map((o) => String(o).trim().slice(0, 200)).filter(Boolean).slice(0, 5);
        const ans = Number(q && q.answerIndex);
        const question = String((q && q.question) || '').trim().slice(0, 300);
        if (!question || options.length < 2 || !Number.isInteger(ans) || ans < 0 || ans >= options.length) return null;
        return { question, options, answerIndex: ans, explanation: String((q && q.explanation) || '').trim().slice(0, 300) };
      })
      .filter(Boolean)
      .slice(0, 8);
    if (qs.length < 3) throw new RuleError('VALIDATION', 'The generated quiz was not usable');
    return { kind: 'mcq', questions: qs };
  }

  /** Without an AI key we can't invent factual questions, so give honest recall prompts built from the topic itself. */
  function fallbackQuiz(topic, prereqTitles) {
    const t = topic.title;
    const prompts = [
      `Explain "${t}" in your own words, as if teaching a beginner.`,
      `Give one example where "${t}" applies and one where it does not.`,
      prereqTitles && prereqTitles.length ? `Which ideas from ${prereqTitles.join(', ')} does "${t}" rely on?` : `What would you need to know before starting "${t}", and why?`,
      `What mistake is a beginner most likely to make with "${t}"?`,
      topic.notes ? `Pick the part of your notes on "${t}" you're least sure about and re-explain it without looking.` : `Write down one question about "${t}" you still can't answer.`,
    ];
    return { kind: 'prompts', questions: prompts.map((p) => ({ prompt: p })) };
  }

  /* ============================================================ coach */

  /** The facts the coach (AI or rule-based) is allowed to talk about. */
  function buildCoachContext({ name, goals, topics, sessions, config, today }) {
    const states = R.computeStates(topics, R.minutesByTopic(sessions));
    const review = R.buildReview({ topics, sessions, config, today });
    const plan = R.suggestPlan({ topics, sessions, config, today });
    const title = (list, id) => (list.find((x) => x.id === id) || {}).title;
    return {
      name,
      today,
      week: { minutes: review.minutes, targetMinutes: review.targetMinutes, targetPercent: review.targetPercent, sessions: review.sessions, activeDays: review.activeDays, streak: review.streak, completed: review.completed, stalled: review.stalled },
      plan: plan.items.map((i) => ({ title: i.title, minutes: i.minutes, reason: i.reason })),
      goals: goals.map((g) => {
        const gt = topics.filter((t) => t.goalId === g.id);
        const gs = sessions.filter((s) => s.goalId === g.id);
        const f = goalForecast({ goal: g, topics: gt, sessions: gs, config, today });
        return {
          title: g.title,
          targetDate: g.targetDate || null,
          percent: R.goalProgress(gt, gs).percent,
          forecast: { status: f.status, headline: f.headline },
          locked: gt.filter((t) => states[t.id].state === 'locked').map((t) => ({ title: t.title, needs: states[t.id].missing.map((id) => title(gt, id)) })),
          ready: gt.filter((t) => ['available', 'in_progress'].includes(states[t.id].state)).map((t) => t.title),
          awaitingApproval: gt.filter((t) => states[t.id].state === 'pending').map((t) => t.title),
        };
      }),
    };
  }

  const COACH_CHIPS = ['What should I study next?', 'Am I on track for my deadlines?', "What's still locked?", 'How was my week?'];

  /** Rule-based coach used when no AI key is set. It answers from the same facts, and says so when it can't help. */
  function coachFallback(message, ctx) {
    const q = String(message || '').toLowerCase();
    const bullets = (a) => a.map((x) => `• ${x}`).join('\n');
    const first = (ctx.name || '').split(' ')[0] || 'there';
    if (/(locked|unlock|blocked|stuck on|can'?t start|prerequisite|why can)/.test(q)) {
      const all = ctx.goals.flatMap((g) => g.locked.map((l) => `${l.title} (${g.title}) needs ${l.needs.join(' and ')}`));
      return all.length ? `Here's what's waiting behind a prerequisite:\n${bullets(all.slice(0, 6))}\nFinish those prerequisites and each one opens up.` : 'Nothing is locked right now — every open topic can be studied.';
    }
    if (/(track|deadline|on pace|on schedule|finish by|when will|behind|late|target)/.test(q)) {
      const rows = ctx.goals.filter((g) => g.forecast.status !== 'empty').map((g) => `${g.title}: ${g.forecast.headline}`);
      return rows.length ? `Deadline check:\n${bullets(rows)}` : 'You have no goals with topics yet, so there is nothing to forecast.';
    }
    if (/(next|study today|what should|what do i do|plan|focus|start)/.test(q)) {
      if (!ctx.plan.length) return 'Nothing is unlocked right now. Finish a prerequisite (or ask your mentor to review a submission) to open the next topic.';
      const [p, ...more] = ctx.plan;
      return `Start with ${p.title} for about ${p.minutes} minutes. ${p.reason}` + (more.length ? `\nAfter that this week: ${more.map((m) => `${m.title} (${m.minutes}m)`).join(', ')}.` : '');
    }
    if (/(how am i|progress|doing|week|review|streak|summary)/.test(q)) {
      const w = ctx.week;
      const parts = [`This week you studied ${fmtMin(w.minutes)} over ${plural(w.sessions, 'session')} — ${w.targetPercent}% of your ${fmtMin(w.targetMinutes)} target.`];
      if (w.streak) parts.push(`Your streak is ${w.streak} day${w.streak === 1 ? '' : 's'}.`);
      if (w.completed.length) parts.push(`Finished: ${w.completed.join(', ')}.`);
      if (w.stalled.length) parts.push(`${w.stalled[0].title} has gone quiet for ${w.stalled[0].daysSince} days.`);
      return parts.join(' ');
    }
    if (/(motivat|tired|lazy|procrastinat|overwhelm|hard|can'?t focus|no time)/.test(q)) {
      const p = ctx.plan[0];
      return p ? `That's normal. Lower the bar: do 15 focused minutes on ${p.title}, then decide whether to stop. Starting is the hard part, and short sessions keep your streak alive.` : 'That is normal. Pick the smallest task you can finish in 15 minutes and do only that.';
    }
    if (/^(hi|hello|hey|yo|good (morning|afternoon|evening))\b/.test(q.trim())) return `Hi ${first}! I can tell you what to study next, whether you're on track for your deadlines, what's locked, or how your week went.`;
    return "I can help with what to study next, whether you're on track, what's locked and why, and how your week went. Try one of those. (I'm the built-in coach; add a Gemini API key for open-ended questions.)";
  }

  /* ============================================================ CSV export */

  /** CSV cell with quote escaping and protection against spreadsheet formula injection (=, +, -, @ at the start). */
  const csvCell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const hours = (m) => (Math.round(((m || 0) / 60) * 10) / 10).toFixed(1);

  function topicsCsv({ goals, topics, sessions }) {
    const rows = [['Goal', 'Topic', 'Status', 'Prerequisites', 'Estimate (h)', 'Logged (h)', 'Completed on']];
    const label = { complete: 'Complete', locked: 'Locked', pending: 'Awaiting approval', in_progress: 'In progress', available: 'Ready' };
    for (const g of goals) {
      const gt = topics.filter((t) => t.goalId === g.id);
      const gs = sessions.filter((s) => s.goalId === g.id);
      const st = R.computeStates(gt, R.minutesByTopic(gs));
      const mins = R.minutesByTopic(gs);
      for (const t of gt) rows.push([g.title, t.title, label[st[t.id].state], t.prerequisites.map((p) => (gt.find((x) => x.id === p) || {}).title).filter(Boolean).join('; '), t.estimateMinutes ? hours(t.estimateMinutes) : '', hours(mins[t.id] || 0), t.completedOn || '']);
    }
    return toCsv(rows);
  }
  function sessionsCsv({ goals, topics, sessions }) {
    const rows = [['Date', 'Time', 'Goal', 'Topic', 'Minutes', 'Note']];
    const gT = new Map(goals.map((g) => [g.id, g.title]));
    const tT = new Map(topics.map((t) => [t.id, t.title]));
    [...sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach((s) => rows.push([s.date, s.time || '', gT.get(s.goalId) || '', tT.get(s.topicId) || '', s.minutes, s.note || '']));
    return toCsv(rows);
  }

  return { DAYS, fmtMin, fmtDate, weekdayOf, goalForecast, WARNING_STATUSES, habits, suggestSchedule, TEMPLATES, fallbackRoadmap, sanitizeRoadmap, sanitizeQuiz, fallbackQuiz, buildCoachContext, coachFallback, COACH_CHIPS, csvCell, topicsCsv, sessionsCsv };
});
