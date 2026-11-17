/*
 * Seed dataset, as pure data (used by the MongoDB seeder and by the offline preview).
 * Brief: three goals, 12 topics with prerequisites, 30 sessions spread over six weeks.
 * Dates are expressed as day offsets from "today" so the demo always looks fresh.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules'));
  else root.SeedData = factory(root.Rules);
})(typeof self !== 'undefined' ? self : this, function (Rules) {
  'use strict';

  const goals = [
    { key: 'dsa', title: 'Master Data Structures & Algorithms', color: 'violet', description: 'Interview-ready fundamentals, from complexity analysis to dynamic programming.', targetOffset: 45 },
    { key: 'web', title: 'Full-Stack Web Development', color: 'cyan', description: 'Ship a secure, database-backed web app end to end.', targetOffset: 60 },
    { key: 'ml', title: 'Applied Machine Learning', color: 'mint', description: 'Build, evaluate and explain classical ML models in Python.', targetOffset: 75 },
  ];

  // completeOffset: day (relative to today) the topic was finished; null = not complete.
  const topics = [
    { key: 'bigo', hours: 3, goal: 'dsa', title: 'Big-O & Complexity', prereqs: [], completeOffset: -34, description: 'Asymptotic notation and reasoning about cost.' },
    { key: 'arrays', hours: 6, goal: 'dsa', title: 'Arrays & Strings', prereqs: ['bigo'], completeOffset: -27, description: 'Two pointers, sliding window, prefix sums.' },
    { key: 'lists', hours: 6, goal: 'dsa', title: 'Linked Lists & Stacks', prereqs: ['arrays'], completeOffset: null, notes: 'Practise: reverse a list iteratively and recursively, then build an LRU cache.', resources: [{ title: 'VisuAlgo — linked lists', url: 'https://visualgo.net/en/list' }], description: 'Pointer manipulation, monotonic stacks.' },
    { key: 'trees', hours: 8, goal: 'dsa', title: 'Trees & Graphs', prereqs: ['lists', 'arrays'], completeOffset: null, description: 'Traversals, BFS/DFS, shortest paths.' },
    { key: 'dp', hours: 10, goal: 'dsa', title: 'Dynamic Programming', prereqs: ['trees', 'bigo'], completeOffset: null, description: 'Memoisation, tabulation, state design.' },

    { key: 'js', hours: 6, goal: 'web', title: 'HTML, CSS & JavaScript', prereqs: [], completeOffset: -30, description: 'The platform fundamentals: DOM, events, async.' },
    { key: 'node', hours: 10, goal: 'web', title: 'Node & Express', prereqs: ['js'], completeOffset: -18, description: 'Routing, middleware and REST design.' },
    { key: 'mongo', hours: 8, goal: 'web', title: 'MongoDB & Data Modelling', prereqs: ['node'], completeOffset: null, notes: 'Embed when data is read together; reference when it grows without bound.', resources: [{ title: 'MongoDB Manual — Indexes', url: 'https://www.mongodb.com/docs/manual/indexes/' }], description: 'Schemas, indexes and aggregation pipelines.' },
    { key: 'auth', hours: 8, goal: 'web', title: 'Auth & Security', prereqs: ['node', 'mongo'], completeOffset: null, description: 'Sessions, JWT, hashing and role-based access.' },

    { key: 'py', hours: 5, goal: 'ml', title: 'Python & NumPy', prereqs: [], completeOffset: -33, description: 'Vectorised thinking with arrays.' },
    { key: 'sup', hours: 10, goal: 'ml', title: 'Supervised Learning', prereqs: ['py'], completeOffset: null, resources: [{ title: 'scikit-learn — supervised learning', url: 'https://scikit-learn.org/stable/supervised_learning.html' }], description: 'Regression, trees and the bias-variance trade-off.' },
    { key: 'eval', hours: 6, goal: 'ml', title: 'Model Evaluation', prereqs: ['sup'], completeOffset: null, description: 'Cross-validation, metrics and error analysis.' },
  ];

  // [topic, dayOffset, minutes, note]  — 30 sessions, oldest to newest, always on unlocked topics.
  const sessions = [
    ['bigo', -41, 45, 'Asymptotic notation basics'],
    ['js', -41, 90, 'DOM and the event loop'],
    ['ml1', -40, 60, 'Vectorisation drills'],
    ['bigo', -39, 30, 'Amortised analysis examples'],
    ['py', -38, 50, 'Broadcasting rules'],
    ['js', -37, 75, 'Closures and promises'],
    ['bigo', -36, 40, 'Practice problems'],
    ['py', -35, 45, 'Slicing and reshaping'],
    ['js', -33, 60, 'Fetch and modules'],
    ['arrays', -33, 50, 'Prefix sums'],
    ['arrays', -31, 60, 'Two pointers'],
    ['arrays', -29, 45, 'Sliding window'],
    ['node', -29, 70, 'First Express server'],
    ['sup', -28, 60, 'Linear regression from scratch'],
    ['node', -26, 60, 'Express routing'],
    ['lists', -25, 45, 'Reversal and cycle detection'],
    ['sup', -24, 55, 'Regularisation'],
    ['node', -22, 80, 'Middleware chains'],
    ['lists', -21, 40, 'Fast and slow pointers'],
    ['node', -20, 55, 'Error handling patterns'],
    ['mongo', -16, 65, 'Schema design'],
    ['lists', -14, 55, 'LRU cache'],
    ['sup', -17, 70, 'Decision trees'],
    ['mongo', -12, 50, 'Indexes and explain()'],
    ['sup', -11, 45, 'Bias-variance notes'],
    ['lists', -9, 35, 'Monotonic stack'],
    ['mongo', -7, 60, 'Aggregation pipeline'],
    ['lists', -2, 30, 'Stack problems'],
    ['sup', -1, 50, 'Cross-validation prep'],
    ['mongo', 0, 45, 'Population and lean queries'],
  ].map(([t, d, m, n]) => [t === 'ml1' ? 'py' : t, d, m, n]);

  // Learners in the demo mostly study in the evening on weekdays and in the morning at weekends.
  const startTime = (date, i) => {
    const dow = Rules.weekdayOf ? Rules.weekdayOf(date) : new Date(date + 'T00:00:00Z').getUTCDay();
    return dow === 0 || dow === 6 ? ['10:00', '10:30', '09:30'][i % 3] : ['19:30', '20:00', '19:00'][i % 3];
  };

  function build(today) {
    return {
      goals: goals.map((g) => ({ ...g, targetDate: Rules.addDays(today, g.targetOffset) })),
      topics: topics.map((t) => ({ ...t, estimateMinutes: (t.hours || 0) * 60, notes: t.notes || '', resources: t.resources || [], completedOn: t.completeOffset == null ? '' : Rules.addDays(today, t.completeOffset) })),
      sessions: sessions.map(([topic, off, minutes, note], i) => { const date = Rules.addDays(today, off); return { topic, date, minutes, note, time: startTime(date, i) }; }),
    };
  }

  // A goal a mentor assigned to a second learner (requires approval). Kept separate so the main learner
  // keeps exactly the brief's 3 goals / 12 topics / 30 sessions.
  function buildAssigned(today) {
    const topicsA = [
      { key: 'rq', title: 'Research questions & hypotheses', hours: 3, prereqs: [], status: 'complete', completedOffset: -20, description: 'Turn a vague interest into a testable question.' },
      { key: 'lit', title: 'Literature review', hours: 5, prereqs: [], status: 'pending', description: 'Find, read and summarise the key prior work.' },
      { key: 'design', title: 'Study design & sampling', hours: 5, prereqs: ['rq'], status: 'open', description: 'Choose a design and a defensible sample.' },
      { key: 'ethics', title: 'Data collection & ethics', hours: 4, prereqs: ['design'], status: 'open', description: 'Collect data responsibly, with consent.' },
      { key: 'report', title: 'Analysis & reporting', hours: 6, prereqs: ['ethics', 'lit'], status: 'open', description: 'Analyse, interpret and write up the findings.' },
    ].map((t) => ({ ...t, estimateMinutes: t.hours * 60, notes: '', resources: [], completedOn: t.status === 'complete' ? Rules.addDays(today, t.completedOffset) : '', pending: t.status === 'pending' }));
    const sess = [['rq', -24, 45, 'Brainstormed three candidate questions'], ['rq', -22, 40, 'Narrowed to one'], ['lit', -18, 60, 'First pass through 10 papers'], ['lit', -15, 50, 'Summary table'], ['lit', -11, 55, 'Gaps and themes'], ['design', -6, 45, 'Compared survey vs experiment'], ['design', -2, 40, 'Sampling options']]
      .map(([topic, off, minutes, note], i) => { const date = Rules.addDays(today, off); return { topic, date, minutes, note, time: startTime(date, i + 1) }; });
    return { goal: { title: 'Research Methods Fundamentals', description: 'Assigned by your mentor — plan, run and report a small study. Each topic needs mentor approval.', color: 'rose', targetDate: Rules.addDays(today, 30) }, topics: topicsA, sessions: sess };
  }

  return { build, buildAssigned, goals, topics, sessions };
});
