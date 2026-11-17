/*
 * In-browser stand-in for client/js/api.js, used ONLY by the offline preview (npm run preview).
 * Same interface and response shapes as the real REST API, backed by the same shared/rules.js and
 * shared/seed-data.js the server uses, so the preview behaves like the real thing (locks, loops, limits, roles).
 * Data lives in memory and resets on reload.
 */
window.API = (function () {
  'use strict';
  const R = window.Rules;
  const F = window.Features;
  const STATUS = { VALIDATION: 400, FORBIDDEN: 403, NOT_FOUND: 404, LOCKED: 409, CONFLICT: 409 };

  class ApiError extends Error {
    constructor(message, status, code, details) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.details = details || {};
    }
  }
  const api = { ApiError, onUnauthorized: null, mock: true };

  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
  const today = () => R.todayInTz(tz);
  let seq = 100;
  const uid = (p) => `${p}${++seq}`;
  const delay = (ms) => new Promise((r) => setTimeout(r, ms == null ? 140 : ms));

  /* ---------- seed ---------- */
  const users = [
    { id: 'u-mentor', name: 'Dr. Kavya Iyer', email: 'mentor@demo.com', password: 'mentor123', role: 'mentor', active: true },
    { id: 'u-aarav', name: 'Aarav Mehta', email: 'learner@demo.com', password: 'learner123', role: 'learner', active: true },
    { id: 'u-diya', name: 'Diya Nair', email: 'diya@demo.com', password: 'learner123', role: 'learner', active: true },
  ];
  const cohorts = [], shares = [];
  const DEMO_TOKEN = 'demo-share-link-aarav-fullstack-0001';
  let config = Object.assign({}, R.DEFAULT_CONFIG);
  const goals = [], topics = [], sessions = [], feedback = [];
  (function seed() {
    const data = window.SeedData.build(today());
    const gid = {}, tid = {};
    data.goals.forEach((g) => { const id = uid('g'); gid[g.key] = id; goals.push({ id, ownerId: 'u-aarav', title: g.title, description: g.description, color: g.color, targetDate: g.targetDate, assigned: false, assignedByName: '', requireApproval: false }); });
    let order = 0;
    data.topics.forEach((t) => { const id = uid('t'); tid[t.key] = id; topics.push({ id, goalId: gid[t.goal], ownerId: 'u-aarav', title: t.title, description: t.description, prerequisites: t.prereqs.map((k) => tid[k]), complete: !!t.completedOn, completedOn: t.completedOn, estimateMinutes: t.estimateMinutes, notes: t.notes, resources: t.resources, pending: false, review: null, order: order++ }); });
    data.sessions.forEach((s) => { const t = topics.find((x) => x.id === tid[s.topic]); sessions.push({ id: uid('s'), ownerId: 'u-aarav', goalId: t.goalId, topicId: t.id, date: s.date, time: s.time, minutes: s.minutes, note: s.note, createdAt: sessions.length }); });
    // a goal the mentor assigned to Diya, needing approval (one topic already submitted)
    const asg = window.SeedData.buildAssigned(today());
    const ag = uid('g'); const at = {};
    goals.push({ id: ag, ownerId: 'u-diya', ...asg.goal, assigned: true, assignedByName: 'Dr. Kavya Iyer', requireApproval: true });
    asg.topics.forEach((t, i) => { const id = uid('t'); at[t.key] = id; topics.push({ id, goalId: ag, ownerId: 'u-diya', title: t.title, description: t.description, prerequisites: t.prereqs.map((k) => at[k]), complete: t.status === 'complete', completedOn: t.completedOn, estimateMinutes: t.estimateMinutes, notes: '', resources: [], pending: t.pending, review: null, pendingAt: t.pending ? Date.now() : null, order: i }); });
    asg.sessions.forEach((x) => { sessions.push({ id: uid('s'), ownerId: 'u-diya', goalId: ag, topicId: at[x.topic], date: x.date, time: x.time, minutes: x.minutes, note: x.note, createdAt: sessions.length }); });
    cohorts.push({ id: uid('c'), name: 'Autumn 2026 batch', description: 'Demo cohort', members: ['u-aarav', 'u-diya'] });
    shares.push({ id: uid('sh'), token: DEMO_TOKEN, goalId: gid.web, ownerId: 'u-aarav', expiresAt: null, createdAt: new Date().toISOString() });
    feedback.push({ id: uid('f'), goalId: gid.web, authorName: 'Dr. Kavya Iyer', text: 'Great pace on Node. Finish the indexing exercises before touching Auth — it will make the security work much easier.', createdAt: new Date().toISOString() });
  })();

  let current = null; // signed-in user
  const pub = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
  window.DEMO_SHARE_TOKEN = DEMO_TOKEN;

  /* ---------- helpers mirroring the server ---------- */
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const fail = (code, msg, details) => { throw new R.RuleError(code, msg, details); };
  const authed = () => { if (!current) throw new ApiError('Please sign in', 401, 'UNAUTHENTICATED'); return current; };
  const canRead = (ownerId) => { const u = authed(); if (u.role !== 'mentor' && u.id !== ownerId) fail('FORBIDDEN', "You can't view another learner's data"); };
  const canEdit = (ownerId) => { const u = authed(); if (u.role !== 'learner' || u.id !== ownerId) fail('FORBIDDEN', u.role === 'mentor' ? 'Mentors have view-only access to learner goals' : 'You can only edit your own goals'); };
  const canStructure = (g) => { const u = authed(); return g.assigned ? u.role === 'mentor' : u.role === 'learner' && u.id === g.ownerId; };
  const assertStructure = (g) => { if (!canStructure(g)) fail('FORBIDDEN', g.assigned ? (current.role === 'mentor' ? 'Not allowed' : 'This goal was assigned by your mentor, so only a mentor can change its structure') : current.role === 'mentor' ? "Mentors have view-only access to learners' own goals" : 'You can only edit your own goals'); };
  const mentorOnly = () => { if (authed().role !== 'mentor') fail('FORBIDDEN', 'Only a mentor can do this'); };
  const goalOf = (id) => goals.find((g) => g.id === id) || fail('NOT_FOUND', 'Goal not found');
  const topicOf = (id) => topics.find((t) => t.id === id) || fail('NOT_FOUND', 'Topic not found');
  const topicsOfGoal = (gid) => topics.filter((t) => t.goalId === gid).sort((a, b) => a.order - b.order);
  const sessionsOfGoal = (gid) => sessions.filter((s) => s.goalId === gid).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));

  function decorate(ts, ss) {
    const mins = R.minutesByTopic(ss);
    const st = R.computeStates(ts, mins);
    const byId = new Map(ts.map((t) => [t.id, t]));
    return ts.map((t) => ({ ...t, state: st[t.id].state, locked: st[t.id].locked, missing: st[t.id].missing.map((id) => ({ id, title: byId.get(id).title })), minutes: mins[t.id] || 0, dependents: R.directDependents(ts, t.id).map((d) => ({ id: d.id, title: d.title })) }));
  }

  function goalPayload(goalId, extra) {
    const g = goalOf(goalId);
    canRead(g.ownerId);
    const ts = clone(topicsOfGoal(goalId)), ss = clone(sessionsOfGoal(goalId));
    const owner = users.find((u) => u.id === g.ownerId);
    const title = new Map(ts.map((t) => [t.id, t.title]));
    return Object.assign({
      goal: clone(g),
      owner: { id: g.ownerId, name: owner ? owner.name : 'Unknown' },
      topics: decorate(ts, ss),
      sessions: ss.slice(0, 60).map((s) => ({ ...s, topicTitle: title.get(s.topicId) || 'Removed topic' })),
      progress: R.goalProgress(ts, ss),
      forecast: F.goalForecast({ goal: g, topics: ts, sessions: ss, config, today: today() }),
      weekly: R.weeklySeries(ss, today()),
      feedback: feedback.filter((f) => f.goalId === goalId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((f) => ({ id: f.id, authorName: f.authorName, text: f.text, createdAt: f.createdAt })),
      canEdit: current.role === 'learner' && current.id === g.ownerId,
      canStructure: canStructure(g),
      canApprove: current.role === 'mentor' && !!g.requireApproval,
      shares: current.role === 'learner' && current.id === g.ownerId ? shares.filter((x) => x.goalId === goalId).map((x) => ({ id: x.id, token: x.token, expiresAt: x.expiresAt, createdAt: x.createdAt })) : [],
      config: clone(config),
      today: today(),
    }, extra || {});
  }

  function resolveLearner(learnerId) {
    const u = authed();
    let id = u.id;
    if (u.role === 'mentor') { if (!learnerId) fail('VALIDATION', 'learnerId is required'); id = learnerId; }
    else if (learnerId && learnerId !== u.id) fail('FORBIDDEN', "You can't view another learner's data");
    const l = users.find((x) => x.id === id && x.role === 'learner') || fail('NOT_FOUND', 'Learner not found');
    return l;
  }
  const dataOf = (ownerId) => ({
    goals: goals.filter((g) => g.ownerId === ownerId).map(clone),
    topics: topics.filter((t) => t.ownerId === ownerId).sort((a, b) => a.order - b.order).map(clone),
    sessions: sessions.filter((s) => s.ownerId === ownerId).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt)).map(clone),
  });

  function createFromRoadmap(goalId, ownerId, rt) {
    const ids = new Map();
    rt.forEach((t, i) => { const id = uid('t'); ids.set(t.key, id); topics.push({ id, goalId, ownerId, title: t.title, description: t.description || '', estimateMinutes: t.estimateMinutes || 0, notes: '', resources: [], pending: false, review: null, prerequisites: t.prerequisites.map((k) => ids.get(k)).filter(Boolean), complete: false, completedOn: '', order: i }); });
  }
  function learnerSummaries() {
    const t0 = today();
    return users.filter((u) => u.role === 'learner' && u.active !== false).map((l) => {
      const { goals: gs, topics: ts, sessions: ss } = dataOf(l.id);
      const done = ts.filter((t) => t.complete).length;
      const atRisk = gs.filter((g) => F.WARNING_STATUSES.includes(F.goalForecast({ goal: g, topics: ts.filter((t) => t.goalId === g.id), sessions: ss.filter((x) => x.goalId === g.id), config, today: t0 }).status)).length;
      return { id: l.id, name: l.name, email: l.email, goals: gs.length, topics: ts.length, topicsComplete: done, percent: ts.length ? Math.round((done / ts.length) * 100) : 0, minutes: ss.reduce((a, s) => a + s.minutes, 0), weekMinutes: ss.filter((s) => s.date >= R.addDays(t0, -6)).reduce((a, s) => a + s.minutes, 0), streak: R.streak(ss, t0), lastActive: ss.length ? ss[0].date : null, atRisk, pendingApprovals: ts.filter((t) => t.pending).length, cohorts: cohorts.filter((c) => c.members.includes(l.id)).map((c) => ({ id: c.id, name: c.name })) };
    });
  }
  function cohortPayload() {
    const sums = learnerSummaries();
    return cohorts.map((c) => {
      const ms = c.members.map((id) => sums.find((x) => x.id === id)).filter(Boolean);
      return { id: c.id, name: c.name, description: c.description || '', memberIds: ms.map((m) => m.id), members: ms.map((m) => ({ id: m.id, name: m.name })), stats: { learners: ms.length, avgPercent: ms.length ? Math.round(ms.reduce((a, m) => a + m.percent, 0) / ms.length) : 0, weekMinutes: ms.reduce((a, m) => a + m.weekMinutes, 0), atRisk: ms.reduce((a, m) => a + m.atRisk, 0), pendingApprovals: ms.reduce((a, m) => a + m.pendingApprovals, 0) } };
    });
  }
  function cohortInput(b) {
    b = b || {};
    const name = String(b.name || '').trim();
    if (name.length < 2 || name.length > 60) fail('VALIDATION', 'Please fix the highlighted fields', { fields: { name: 'Name must be 2–60 characters' } });
    const ids = [...new Set(b.memberIds || [])];
    if (!ids.every((id) => users.some((u) => u.id === id && u.role === 'learner'))) fail('VALIDATION', 'Please fix the highlighted fields', { fields: { members: 'Cohorts can only contain learners' } });
    return { name, description: String(b.description || '').slice(0, 300), members: ids };
  }

  /* ---------- endpoint implementations ---------- */
  const impl = {
    me: () => ({ user: pub(authed()) }),
    login: (email, password) => {
      const u = users.find((x) => x.email === String(email || '').toLowerCase().trim() && x.password === password);
      if (u && u.active === false) throw new ApiError('This account has been deactivated — ask your mentor', 401, 'UNAUTHENTICATED');
      if (!u) throw new ApiError('Wrong email or password', 401, 'UNAUTHENTICATED');
      current = u;
      return { user: pub(u) };
    },
    register: (name, email, password) => {
      const fields = {};
      if (!name || String(name).trim().length < 2) fields.name = 'Enter your name';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) fields.email = 'Enter a valid email';
      if (!password || String(password).length < 8) fields.password = 'At least 8 characters';
      if (Object.keys(fields).length) fail('VALIDATION', 'Please fix the highlighted fields', { fields });
      if (users.some((u) => u.email === String(email).toLowerCase())) fail('VALIDATION', 'That email is already registered', { fields: { email: 'Already registered' } });
      const u = { id: uid('u'), name: String(name).trim(), email: String(email).toLowerCase().trim(), password, role: 'learner', active: true };
      users.push(u);
      current = u;
      return { user: pub(u) };
    },
    logout: () => { current = null; return { ok: true }; },
    changePassword: (cur, nw) => {
      if (authed().password !== cur) fail('VALIDATION', 'Please fix the highlighted fields', { fields: { currentPassword: 'Incorrect password' } });
      if (!nw || String(nw).length < 8) fail('VALIDATION', 'Please fix the highlighted fields', { fields: { newPassword: 'At least 8 characters' } });
      current.password = String(nw);
      return { ok: true };
    },

    config: () => { authed(); return { config: clone(config) }; },
    saveConfig: (values) => {
      if (authed().role !== 'mentor') fail('FORBIDDEN', 'Only a mentor can do this');
      config = R.validateConfig(values, config);
      return { config: clone(config) };
    },

    dashboard: (learnerId) => {
      const l = resolveLearner(learnerId);
      const t0 = today();
      const { goals: gs, topics: ts, sessions: ss } = dataOf(l.id);
      const st = R.computeStates(ts, R.minutesByTopic(ss));
      const gById = new Map(gs.map((g) => [g.id, g]));
      const tTitle = new Map(ts.map((t) => [t.id, t.title]));
      const goalCards = gs.map((g) => {
        const gt = ts.filter((t) => t.goalId === g.id), gss = ss.filter((s) => s.goalId === g.id);
        const next = gt.find((t) => ['in_progress', 'available'].includes(st[t.id].state));
        return { ...g, forecast: F.goalForecast({ goal: g, topics: gt, sessions: gss, config, today: t0 }), pendingCount: gt.filter((t) => t.pending).length, progress: R.goalProgress(gt, gss), locked: gt.filter((t) => st[t.id].state === 'locked').length, nextUp: next ? { id: next.id, title: next.title, state: st[next.id].state } : null };
      });
      const last7 = ss.filter((s) => s.date >= R.addDays(t0, -6));
      const alerts = goalCards.filter((g) => F.WARNING_STATUSES.includes(g.forecast.status)).map((g) => ({ goalId: g.id, title: g.title, color: g.color, status: g.forecast.status, headline: g.forecast.headline, requiredMinutesPerWeek: g.forecast.requiredMinutesPerWeek }));
      return {
        alerts,
        learner: { id: l.id, name: l.name }, today: t0, config: clone(config),
        totals: { goals: gs.length, topics: ts.length, topicsComplete: ts.filter((t) => t.complete).length, minutes: ss.reduce((a, s) => a + s.minutes, 0), sessions: ss.length, locked: ts.filter((t) => st[t.id].state === 'locked').length, weekMinutes: last7.reduce((a, s) => a + s.minutes, 0) },
        goals: goalCards, weekly: R.weeklySeries(ss, t0), heatmap: R.heatmap(ss, t0, 42), streak: R.streak(ss, t0),
        recent: ss.slice(0, 8).map((s) => ({ ...s, topicTitle: tTitle.get(s.topicId) || 'Removed topic', goalTitle: (gById.get(s.goalId) || {}).title || '', goalColor: (gById.get(s.goalId) || {}).color || 'violet' })),
        readyToStart: ts.filter((t) => ['available', 'in_progress'].includes(st[t.id].state)).slice(0, 6).map((t) => ({ id: t.id, goalId: t.goalId, title: t.title, state: st[t.id].state, goalTitle: (gById.get(t.goalId) || {}).title, color: (gById.get(t.goalId) || {}).color })),
        canEdit: authed().role === 'learner',
      };
    },
    learners: () => {
      mentorOnly();
      return { today: today(), learners: learnerSummaries() };
    },
    insights: (learnerId) => {
      const l = resolveLearner(learnerId);
      const t0 = today();
      const { topics: ts, sessions: ss } = dataOf(l.id);
      const review = R.buildReview({ topics: ts, sessions: ss, config, today: t0 });
      return { learner: { id: l.id, name: l.name }, today: t0, review, narrative: { text: R.narrate(review, l.name), source: 'engine' }, plan: R.suggestPlan({ topics: ts, sessions: ss, config, today: t0 }), schedule: F.suggestSchedule({ topics: ts, sessions: ss, config, today: t0 }) };
    },

    goals: (learnerId) => {
      const l = resolveLearner(learnerId);
      const { goals: gs, topics: ts, sessions: ss } = dataOf(l.id);
      return { goals: gs.map((g) => { const gt = ts.filter((t) => t.goalId === g.id), gss = ss.filter((s) => s.goalId === g.id); return { ...g, progress: R.goalProgress(gt, gss), forecast: F.goalForecast({ goal: g, topics: gt, sessions: gss, config, today: today() }) }; }) };
    },
    goal: (id) => goalPayload(id),
    createGoal: (data) => {
      if (authed().role !== 'learner') fail('FORBIDDEN', 'Mentors have view-only access to learner goals');
      const clean = R.validateGoalInput(data);
      const g = { id: uid('g'), ownerId: current.id, ...clean, assigned: false, assignedByName: '', requireApproval: false };
      goals.push(g);
      return goalPayload(g.id);
    },
    updateGoal: (id, data) => {
      const g = goalOf(id);
      assertStructure(g);
      Object.assign(g, R.validateGoalInput({ ...g, ...data }));
      return goalPayload(id);
    },
    deleteGoal: (id) => {
      const g = goalOf(id);
      assertStructure(g);
      for (let i = shares.length - 1; i >= 0; i--) if (shares[i].goalId === id) shares.splice(i, 1);
      [topics, sessions, feedback].forEach((arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i].goalId === id) arr.splice(i, 1); });
      goals.splice(goals.indexOf(g), 1);
      return { ok: true };
    },
    addFeedback: (goalId, text) => {
      if (authed().role !== 'mentor') fail('FORBIDDEN', 'Only a mentor can do this');
      goalOf(goalId);
      const t = String(text || '').trim();
      if (!t || t.length > 600) fail('VALIDATION', 'Write 1–600 characters', { fields: { text: 'Write 1–600 characters' } });
      feedback.push({ id: uid('f'), goalId, authorName: current.name, text: t, createdAt: new Date().toISOString() });
      return goalPayload(goalId);
    },

    createTopic: (goalId, data) => {
      const g = goalOf(goalId);
      assertStructure(g);
      const ts = topicsOfGoal(goalId);
      const clean = R.validateTopicInput(data);
      const prerequisites = R.validatePrerequisites({ topics: ts, topicId: null, prerequisites: data.prerequisites, config });
      topics.push({ id: uid('t'), goalId, ownerId: g.ownerId, ...clean, prerequisites, complete: false, completedOn: '', pending: false, review: null, order: ts.length });
      return goalPayload(goalId);
    },
    updateTopic: (id, data) => {
      const t = topicOf(id);
      assertStructure(goalOf(t.goalId));
      const siblings = topicsOfGoal(t.goalId);
      const clean = R.validateTopicInput({ ...t, ...data });
      let prerequisites = t.prerequisites;
      if (data.prerequisites !== undefined) {
        prerequisites = R.validatePrerequisites({ topics: siblings, topicId: t.id, prerequisites: data.prerequisites, config });
        const byId = new Map(siblings.map((x) => [x.id, x]));
        const incomplete = prerequisites.filter((p) => !byId.get(p).complete);
        if (t.complete && incomplete.length) fail('CONFLICT', `Reopen "${t.title}" before adding an unfinished prerequisite (${byId.get(incomplete[0]).title})`);
      }
      Object.assign(t, clean, { prerequisites });
      return goalPayload(t.goalId);
    },
    deleteTopic: (id) => {
      const t = topicOf(id);
      assertStructure(goalOf(t.goalId));
      topics.forEach((x) => { x.prerequisites = x.prerequisites.filter((p) => p !== id); });
      for (let i = sessions.length - 1; i >= 0; i--) if (sessions[i].topicId === id) sessions.splice(i, 1);
      topics.splice(topics.indexOf(t), 1);
      return goalPayload(t.goalId);
    },
    completeTopic: (id) => {
      const t = topicOf(id);
      canEdit(t.ownerId);
      const g = goalOf(t.goalId);
      const siblings = clone(topicsOfGoal(t.goalId));
      const before = R.computeStates(siblings);
      const plan = R.planComplete(siblings, id, { needsApproval: !!g.requireApproval }); // throws LOCKED with the missing prerequisites
      if (plan.changed.length) {
        if (plan.pending) { t.pending = true; t.pendingAt = Date.now(); t.review = null; }
        else { t.complete = true; t.completedOn = today(); t.pending = false; }
      }
      const payload = goalPayload(t.goalId);
      const unlocked = payload.topics.filter((x) => before[x.id].state === 'locked' && !x.locked).map((x) => ({ id: x.id, title: x.title }));
      return { ...payload, unlocked, submitted: !!plan.pending };
    },
    reopenTopic: (id) => {
      const t = topicOf(id);
      canEdit(t.ownerId);
      const plan = R.planReopen(clone(topicsOfGoal(t.goalId)), id, config);
      topics.forEach((x) => { if (plan.reopened.includes(x.id)) { x.complete = false; x.completedOn = ''; x.pending = false; } });
      return { ...goalPayload(t.goalId), reopened: plan.reopened, relocked: plan.relocked };
    },
    approveTopic: (id, comment) => {
      mentorOnly();
      const t = topicOf(id);
      R.planApprove(clone(topicsOfGoal(t.goalId)), id);
      Object.assign(t, { complete: true, completedOn: today(), pending: false, review: { status: 'approved', comment: String(comment || '').slice(0, 300), byName: current.name, at: new Date().toISOString() } });
      return goalPayload(t.goalId);
    },
    rejectTopic: (id, comment) => {
      mentorOnly();
      const t = topicOf(id);
      R.planReject(clone(topicsOfGoal(t.goalId)), id);
      const c = String(comment || '').trim();
      if (!c || c.length > 300) fail('VALIDATION', 'Tell the learner what to fix (1–300 characters)', { fields: { comment: 'Write 1–300 characters' } });
      Object.assign(t, { pending: false, review: { status: 'changes', comment: c, byName: current.name, at: new Date().toISOString() } });
      return goalPayload(t.goalId);
    },
    saveNotes: (id, body) => {
      const t = topicOf(id);
      canEdit(t.ownerId);
      const b = body || {};
      const clean = R.validateTopicInput({ ...t, notes: b.notes !== undefined ? b.notes : t.notes, resources: b.resources !== undefined ? b.resources : t.resources });
      t.notes = clean.notes; t.resources = clean.resources;
      return goalPayload(t.goalId);
    },
    importGoal: (goal, tps) => {
      if (authed().role !== 'learner') fail('FORBIDDEN', 'Only learners can do this');
      const meta = R.validateGoalInput(goal || {});
      const road = F.sanitizeRoadmap({ topics: tps }, config);
      const g = { id: uid('g'), ownerId: current.id, ...meta, assigned: false, assignedByName: '', requireApproval: false };
      goals.push(g);
      createFromRoadmap(g.id, current.id, road.topics);
      return goalPayload(g.id);
    },
    createShare: (goalId, days) => {
      const g = goalOf(goalId);
      canEdit(g.ownerId);
      if (![0, 7, 30, 90].includes(Number(days))) fail('VALIDATION', 'Choose 7, 30, 90 days or no expiry');
      shares.push({ id: uid('sh'), token: 'pw' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36), goalId, ownerId: g.ownerId, expiresAt: days ? new Date(Date.now() + days * 86400000).toISOString() : null, createdAt: new Date().toISOString() });
      return goalPayload(goalId);
    },
    revokeShare: (id) => {
      const sh = shares.find((x) => x.id === id) || fail('NOT_FOUND', 'Share link not found');
      canEdit(sh.ownerId);
      shares.splice(shares.indexOf(sh), 1);
      return goalPayload(sh.goalId);
    },
    sharedGoal: (token) => {
      const sh = shares.find((x) => x.token === token);
      if (!sh || (sh.expiresAt && new Date(sh.expiresAt) < new Date())) fail('NOT_FOUND', 'This link is invalid, expired or has been revoked');
      const g = goalOf(sh.goalId);
      const ts = clone(topicsOfGoal(g.id)), ss = clone(sessionsOfGoal(g.id));
      const owner = users.find((u) => u.id === g.ownerId);
      return {
        readOnly: true, learnerFirstName: owner ? owner.name.split(/\s+/)[0] : 'A learner',
        goal: { title: g.title, description: g.description, color: g.color, targetDate: g.targetDate },
        topics: decorate(ts, ss).map((t) => ({ id: t.id, title: t.title, description: t.description, prerequisites: t.prerequisites, state: t.state, locked: t.locked, missing: t.missing, minutes: t.minutes, estimateMinutes: t.estimateMinutes, completedOn: t.completedOn })),
        progress: R.goalProgress(ts, ss), weekly: R.weeklySeries(ss, today()), forecast: F.goalForecast({ goal: g, topics: ts, sessions: ss, config, today: today() }), expiresAt: sh.expiresAt, today: today(),
      };
    },

    /* ----- AI features: the preview always uses the built-in logic ----- */
    roadmap: (subject, level) => {
      authed();
      const sub = String(subject || '').trim().replace(/^(i want to |i'd like to |please )?(learn|study|master)\s+/i, '');
      if (sub.length < 2) fail('VALIDATION', 'What would you like to learn?', { fields: { subject: 'Enter a subject' } });
      const fb = F.fallbackRoadmap({ subject: sub, level: level || 'beginner' });
      const road = F.sanitizeRoadmap(fb, config);
      return { roadmap: { title: road.title || sub, description: road.description || '', topics: road.topics }, source: fb.source === 'template' ? 'template' : 'generic', ai: false };
    },
    quiz: (topicId) => {
      const t = topicOf(topicId);
      canRead(t.ownerId);
      const pre = t.prerequisites.map((id) => (topics.find((x) => x.id === id) || {}).title).filter(Boolean);
      return { quiz: F.fallbackQuiz(t, pre), source: 'builtin', topic: { id: t.id, title: t.title } };
    },
    quizAttempt: (topicId, score, total) => { const t = topicOf(topicId); canEdit(t.ownerId); return { attempts: [{ score, total, at: new Date().toISOString() }] }; },
    coach: (message) => {
      const u = authed();
      if (u.role !== 'learner') fail('VALIDATION', 'The coach is for learners');
      const m = String(message || '').trim();
      if (!m) fail('VALIDATION', 'Type a message');
      const d = dataOf(u.id);
      const ctx = F.buildCoachContext({ name: u.name, goals: d.goals, topics: d.topics, sessions: d.sessions, config, today: today() });
      return { reply: F.coachFallback(m, ctx), source: 'builtin', chips: F.COACH_CHIPS };
    },

    /* ----- export (the preview shows the CSV instead of downloading) ----- */
    exportUrl: () => '#',
    exportDownload: (kind, params) => {
      const p = params || {};
      const l = resolveLearner(p.learnerId);
      let d = dataOf(l.id);
      if (p.goalId) d = { goals: d.goals.filter((g) => g.id === p.goalId), topics: d.topics.filter((t) => t.goalId === p.goalId), sessions: d.sessions.filter((x) => x.goalId === p.goalId) };
      return { filename: `pathwise-${kind}.csv`, text: kind === 'sessions' ? F.sessionsCsv(d) : F.topicsCsv(d) };
    },

    /* ----- people, cohorts, assignment, approvals (mentor only) ----- */
    adminUsers: () => { mentorOnly(); return { users: users.map((u) => ({ ...pub(u), active: u.active !== false, cohorts: cohorts.filter((c) => c.members.includes(u.id)).map((c) => ({ id: c.id, name: c.name })) })) }; },
    adminCreateUser: (b) => {
      mentorOnly();
      b = b || {};
      const fields = {};
      if (!b.name || String(b.name).trim().length < 2) fields.name = 'Enter a name';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email || ''))) fields.email = 'Enter a valid email';
      if (!['learner', 'mentor'].includes(b.role)) fields.role = 'Choose learner or mentor';
      if (b.password && String(b.password).length < 8) fields.password = 'At least 8 characters';
      if (Object.keys(fields).length) fail('VALIDATION', 'Please fix the highlighted fields', { fields });
      if (users.some((u) => u.email === String(b.email).toLowerCase().trim())) fail('VALIDATION', 'Please fix the highlighted fields', { fields: { email: 'Already registered' } });
      const pw = b.password ? String(b.password) : Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8).toUpperCase();
      const u = { id: uid('u'), name: String(b.name).trim(), email: String(b.email).toLowerCase().trim(), password: pw, role: b.role, active: true };
      users.push(u);
      return { user: { ...pub(u), active: true }, tempPassword: b.password ? null : pw };
    },
    adminUpdateUser: (id, b) => {
      mentorOnly();
      const u = users.find((x) => x.id === id) || fail('NOT_FOUND', 'User not found');
      b = b || {};
      const self = u.id === current.id;
      const others = () => users.filter((x) => x.role === 'mentor' && x.active !== false && x.id !== u.id).length;
      if (b.name !== undefined) { if (String(b.name).trim().length < 2) fail('VALIDATION', 'Please fix the highlighted fields', { fields: { name: 'Enter a name' } }); u.name = String(b.name).trim(); }
      if (b.role !== undefined && b.role !== u.role) { if (self) fail('CONFLICT', "You can't change your own role"); if (u.role === 'mentor' && !others()) fail('CONFLICT', 'There must always be at least one active mentor'); u.role = b.role; }
      if (b.active !== undefined && !!b.active !== (u.active !== false)) { if (!b.active) { if (self) fail('CONFLICT', "You can't deactivate your own account"); if (u.role === 'mentor' && !others()) fail('CONFLICT', 'There must always be at least one active mentor'); } u.active = !!b.active; }
      return { user: { ...pub(u), active: u.active !== false } };
    },
    adminResetPassword: (id) => { mentorOnly(); const u = users.find((x) => x.id === id) || fail('NOT_FOUND', 'User not found'); u.password = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8).toUpperCase(); return { tempPassword: u.password }; },
    cohorts: () => { mentorOnly(); return { cohorts: cohortPayload() }; },
    createCohort: (b) => { mentorOnly(); const d = cohortInput(b); if (cohorts.some((c) => c.name === d.name)) fail('VALIDATION', 'Please fix the highlighted fields', { fields: { name: 'A cohort with this name already exists' } }); cohorts.push({ id: uid('c'), ...d }); return { cohorts: cohortPayload() }; },
    updateCohort: (id, b) => { mentorOnly(); const c = cohorts.find((x) => x.id === id) || fail('NOT_FOUND', 'Cohort not found'); const d = cohortInput({ ...c, memberIds: c.members, ...b }); if (cohorts.some((x) => x.name === d.name && x.id !== id)) fail('VALIDATION', 'Please fix the highlighted fields', { fields: { name: 'A cohort with this name already exists' } }); Object.assign(c, d); return { cohorts: cohortPayload() }; },
    deleteCohort: (id) => { mentorOnly(); const c = cohorts.find((x) => x.id === id) || fail('NOT_FOUND', 'Cohort not found'); cohorts.splice(cohorts.indexOf(c), 1); return { cohorts: cohortPayload() }; },
    assignGoal: (b) => {
      mentorOnly();
      b = b || {};
      const meta = R.validateGoalInput(b.goal || {});
      const road = F.sanitizeRoadmap({ topics: b.topics }, config);
      const ids = new Set(b.learnerIds || []);
      (b.cohortIds || []).forEach((cid) => { const c = cohorts.find((x) => x.id === cid) || fail('NOT_FOUND', 'Cohort not found'); c.members.forEach((m) => ids.add(m)); });
      if (!ids.size) fail('VALIDATION', 'Please fix the highlighted fields', { fields: { learnerIds: 'Choose at least one learner or cohort' } });
      const ls = [...ids].map((id) => users.find((u) => u.id === id && u.role === 'learner' && u.active !== false));
      if (ls.some((x) => !x)) fail('VALIDATION', 'Only active learners can be assigned goals');
      ls.forEach((l) => { const g = { id: uid('g'), ownerId: l.id, ...meta, assigned: true, assignedByName: current.name, requireApproval: !!b.requireApproval, createdAt: Date.now() }; goals.push(g); createFromRoadmap(g.id, l.id, road.topics); });
      return { assignedTo: ls.map((l) => ({ id: l.id, name: l.name })), topics: road.topics.length };
    },
    assignedGoals: () => {
      mentorOnly();
      return { assigned: goals.filter((g) => g.assigned).map((g) => { const gt = topics.filter((t) => t.goalId === g.id); return { id: g.id, title: g.title, learnerId: g.ownerId, learnerName: (users.find((u) => u.id === g.ownerId) || {}).name, targetDate: g.targetDate, requireApproval: !!g.requireApproval, assignedByName: g.assignedByName, topics: gt.length, complete: gt.filter((t) => t.complete).length, pending: gt.filter((t) => t.pending).length }; }) };
    },
    approvals: () => {
      mentorOnly();
      return { approvals: topics.filter((t) => t.pending).sort((a, b) => (a.pendingAt || 0) - (b.pendingAt || 0)).map((t) => { const g = goalOf(t.goalId); return { topicId: t.id, title: t.title, goalId: t.goalId, goalTitle: g.title, color: g.color, learnerId: t.ownerId, learnerName: (users.find((u) => u.id === t.ownerId) || {}).name, submittedAt: t.pendingAt, minutes: sessions.filter((x) => x.topicId === t.id).reduce((a, x) => a + x.minutes, 0), estimateMinutes: t.estimateMinutes || 0 }; }) };
    },

    sessions: (params) => {
      const u = authed();
      const p = params || {};
      let ownerId = u.id;
      if (u.role === 'mentor') { if (!p.learnerId) fail('VALIDATION', 'learnerId is required'); ownerId = p.learnerId; }
      const gById = new Map(goals.map((g) => [g.id, g]));
      const tById = new Map(topics.map((t) => [t.id, t]));
      let rows = dataOf(ownerId).sessions;
      if (p.goalId) rows = rows.filter((s) => s.goalId === p.goalId);
      if (p.topicId) rows = rows.filter((s) => s.topicId === p.topicId);
      return { sessions: rows.slice(0, Math.min(Number(p.limit) || 100, 500)).map((s) => ({ ...s, topicTitle: (tById.get(s.topicId) || {}).title || 'Removed topic', goalTitle: (gById.get(s.goalId) || {}).title || '', goalColor: (gById.get(s.goalId) || {}).color || 'violet' })) };
    },
    logSession: (body) => {
      const b = body || {};
      const t = topics.find((x) => x.id === b.topicId);
      if (!t) fail('VALIDATION', 'Please fix the highlighted fields', { fields: { topic: 'Choose a topic' } });
      canEdit(t.ownerId);
      const siblings = clone(topicsOfGoal(t.goalId));
      const state = R.computeStates(siblings)[t.id];
      const clean = R.validateSession({ input: b, topic: t, state, config, today: today() });
      const s = { id: uid('s'), ownerId: t.ownerId, goalId: t.goalId, topicId: t.id, ...clean, createdAt: sessions.length + 1000 };
      sessions.push(s);
      return { session: clone(s) };
    },
    deleteSession: (id) => {
      const s = sessions.find((x) => x.id === id) || fail('NOT_FOUND', 'Session not found');
      canEdit(s.ownerId);
      sessions.splice(sessions.indexOf(s), 1);
      return { ok: true };
    },
  };

  // Expose every method with the same async signature as the real client; map RuleError → ApiError like the server does.
  Object.keys(impl).forEach((name) => {
    api[name] = async (...args) => {
      await delay();
      try {
        return clone(impl[name](...args));
      } catch (e) {
        if (e instanceof R.RuleError) throw new ApiError(e.message, STATUS[e.code] || 400, e.code, e.details);
        if (e instanceof ApiError) { if (e.status === 401 && api.onUnauthorized && name !== 'me') api.onUnauthorized(); throw e; }
        throw e;
      }
    };
  });
  return api;
})();
