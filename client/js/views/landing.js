/* Public home page: hero with a playable lock/unlock demo, feature grid, how it works, roles, AI roadmap try-out. */
window.Views = window.Views || {};
(function () {
  'use strict';

  /* ---------- playable prerequisite demo ---------- */
  function demoGraph() {
    // x/y are % of the box; w/h are % too. Edges run from a node's right edge to the next node's left edge (or bottom → top).
    const N = [
      { id: 'html', t: 'HTML & CSS', x: 1, y: 38, pre: [] },
      { id: 'js', t: 'JavaScript', x: 36, y: 38, pre: ['html'] },
      { id: 'react', t: 'React', x: 71, y: 8, pre: ['js'] },
      { id: 'node', t: 'Node & APIs', x: 71, y: 38, pre: ['js'] },
      { id: 'db', t: 'Databases', x: 71, y: 68, pre: ['node'] },
    ];
    const W = 28, H = 20;
    const done = new Set();
    const by = Object.fromEntries(N.map((n) => [n.id, n]));
    const locked = (n) => n.pre.some((p) => !done.has(p));
    const msg = h('div', { class: 'demo-msg' });
    const box = h('div', { class: 'demo-box' });
    const lines = svg('svg', { class: 'demo-edges', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const nodes = {};
    for (const n of N) {
      const b = h('button', { class: 'dnode', type: 'button', style: { left: n.x + '%', top: n.y + '%', width: W + '%', height: H + '%' }, onclick: (e) => click(n, e) }, h('span', { class: 'ic' }), h('b', null, n.t), h('small'));
      nodes[n.id] = b;
    }
    const edges = [];
    for (const n of N) for (const p of n.pre) {
      const a = by[p];
      const vertical = a.x === n.x;
      const x1 = vertical ? a.x + W / 2 : a.x + W, y1 = vertical ? a.y + H : a.y + H / 2;
      const x2 = vertical ? n.x + W / 2 : n.x, y2 = vertical ? n.y : n.y + H / 2;
      const mx = (x1 + x2) / 2;
      const path = svg('path', { d: vertical ? `M${x1},${y1} L${x2},${y2}` : `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, class: 'dedge', 'vector-effect': 'non-scaling-stroke' });
      lines.append(path);
      edges.push([p, n.id, path]);
    }
    box.append(lines, ...Object.values(nodes));
    const paint = (note) => {
      for (const n of N) {
        const b = nodes[n.id];
        const st = done.has(n.id) ? 'complete' : locked(n) ? 'locked' : 'available';
        b.className = 'dnode ' + st;
        b.querySelector('.ic').replaceChildren(Icon(st === 'complete' ? 'check' : st === 'locked' ? 'lock' : 'play'));
        b.querySelector('small').textContent = st === 'complete' ? 'Complete' : st === 'locked' ? 'Locked' : 'Ready';
        b.setAttribute('aria-label', `${n.t}: ${st}`);
      }
      for (const [p, , path] of edges) path.classList.toggle('done', done.has(p));
      msg.className = 'demo-msg' + (note ? ' on' : '');
      const n = note || [Icon('info'), 'Click a ', h('b', null, 'ready'), ' topic to complete it — and watch the next ones unlock.'];
      msg.replaceChildren(n[0], h('span', null, ...n.slice(1)));
    };
    function click(n, e) {
      if (locked(n)) {
        const need = n.pre.filter((p) => !done.has(p)).map((p) => by[p].t);
        const b = nodes[n.id];
        b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
        return paint([Icon('lock'), `${n.t} is locked — finish `, h('b', null, need.join(', ')), ' first.']);
      }
      if (done.has(n.id)) {
        // reopening re-locks everything downstream
        const relocked = [];
        const walk = (id) => N.forEach((m) => { if (m.pre.includes(id) && done.has(m.id)) { done.delete(m.id); relocked.push(m.t); walk(m.id); } });
        done.delete(n.id); walk(n.id);
        return paint([Icon('undo'), `${n.t} reopened`, relocked.length ? ` — ${relocked.join(', ')} locked again.` : '.']);
      }
      done.add(n.id);
      const r = nodes[n.id].getBoundingClientRect();
      UI.confetti(r.left + r.width / 2, r.top + r.height / 2);
      const opened = N.filter((m) => m.pre.includes(n.id) && !locked(m)).map((m) => m.t);
      paint([Icon('unlock'), `${n.t} complete`, opened.length ? ' — unlocked ' : '.', opened.length ? h('b', null, opened.join(', ')) : null]);
      if (N.every((m) => done.has(m.id))) setTimeout(() => paint([Icon('check'), 'Whole path complete. Click any topic to reopen it and see dependants re-lock.']), 900);
    }
    paint();
    const reset = h('button', { class: 'btn sm', type: 'button', onclick: () => { done.clear(); paint(); } }, Icon('undo'), 'Reset');
    return h('div', { class: 'demo-card card' },
      h('div', { class: 'demo-head' }, h('span', { class: 'chip' }, Icon('graph'), 'Learn web development'), reset),
      box, msg);
  }

  /* ---------- AI roadmap try-out (uses the built-in templates in the browser) ---------- */
  function roadmapTry() {
    const input = h('input', { class: 'input', placeholder: 'e.g. Learn Rust', value: 'Learn Rust', 'aria-label': 'What do you want to learn?' });
    const out = h('div', { class: 'rm-out' });
    const go = () => {
      const subject = input.value.trim();
      if (subject.length < 2) return;
      const f = window.Features;
      let road;
      try { road = f.sanitizeRoadmap(f.fallbackRoadmap({ subject, level: 'beginner' }), window.Rules.DEFAULT_CONFIG); } catch { return; }
      const pos = new Map(road.topics.map((t, i) => [t.key, i]));
      out.replaceChildren(
        h('div', { class: 'rm-title' }, h('b', null, road.title || subject), h('span', { class: 'chip' }, Icon('clock'), `≈ ${Math.round(road.topics.reduce((a, t) => a + (t.estimateMinutes || 0), 0) / 60)} h`)),
        h('ol', { class: 'rm-list' }, road.topics.map((t, i) => h('li', { class: 'reveal', style: { '--i': i } }, h('b', null, t.title), h('small', null, t.prerequisites.length ? 'after ' + t.prerequisites.map((k) => road.topics[pos.get(k)].title).join(', ') : 'start here')))),
        h('p', { class: 'hint' }, 'Sign in to edit this roadmap, turn it into a goal, and have it checked for loops automatically.'));
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    const btn = h('button', { class: 'btn primary', type: 'button', onclick: go }, Icon('wand'), 'Generate');
    go();
    return h('div', { class: 'card rm-try' }, h('div', { class: 'rm-form' }, input, btn), out);
  }

  const FEATURES = [
    ['lock', 'violet', 'Prerequisite locks', 'A topic stays locked until everything it depends on is complete. Reopen one and its dependants lock again.'],
    ['trending', 'mint', 'Deadline forecasts', 'Estimate hours per topic and Pathwise projects whether you will hit the goal’s target date at your current pace.'],
    ['wand', 'cyan', 'Roadmap generator', 'Type “Learn Rust” and get a proposed set of topics with prerequisites — checked for loops before you save it.'],
    ['message', 'amber', 'Quiz & study coach', 'Self-check quizzes per topic, and a coach that answers from your real progress, not generic advice.'],
    ['calendar', 'sky', 'Plans that fit your habits', 'Your weekly plan is scheduled on the days and times you actually study, only using unlocked topics.'],
    ['shield', 'rose', 'Mentor assigns & approves', 'Mentors assign goals, structure the path and approve topic completion before dependants unlock.'],
    ['users', 'violet', 'Cohorts', 'Group learners into batches, assign a goal to a whole cohort and see who is at risk at a glance.'],
    ['share', 'cyan', 'Read-only share links', 'Share one goal with a parent, manager or friend. Names, notes and links are never exposed; revoke any time.'],
    ['download', 'mint', 'CSV & PDF export', 'Take your progress with you — spreadsheet-safe CSV and a clean PDF report.'],
    ['link', 'amber', 'Notes & resources', 'Keep notes and reference links on every topic so what you learned stays next to where you learned it.'],
  ];

  Views.landing = function () {
    const scr = (el, i) => { el.classList.add('scr'); if (i != null) el.style.setProperty('--i', i); return el; };
    const nav = h('header', { class: 'lnav' },
      h('a', { href: '#/', class: 'lbrand' }, App.brand(false)),
      h('nav', { class: 'llinks', 'aria-label': 'Sections' }, ...[['features', 'Features'], ['how', 'How it works'], ['ai', 'AI roadmap'], ['teams', 'For mentors']].map(([id, l]) => h('a', { href: '#' + id, onclick: (e) => { e.preventDefault(); const el = document.getElementById('sec-' + id); el && el.scrollIntoView({ behavior: UI.reduced() ? 'auto' : 'smooth', block: 'start' }); } }, l))),
      h('div', { class: 'lactions' }, App.themeBtn(), h('a', { class: 'btn sm', href: '#/login' }, 'Sign in'), h('a', { class: 'btn sm primary', href: '#/register' }, 'Get started')));

    const hero = h('section', { class: 'lhero' },
      h('div', { class: 'lhero-copy' },
        h('span', { class: 'eyebrow' }, Icon('sparkles'), 'New · AI roadmaps, mentor approvals & deadline forecasts'),
        h('h1', null, 'Study in the ', h('em', null, 'right order.')),
        h('p', null, 'Pathwise maps every topic you need to learn, locks what isn’t ready yet, and unlocks the next step the moment you finish a prerequisite. See if you’ll hit your deadline — before it’s too late.'),
        h('div', { class: 'lcta' }, h('a', { class: 'btn primary lg', href: '#/register' }, 'Start free', Icon('arrow')), h('a', { class: 'btn lg', href: '#/login' }, Icon('play'), 'Try the live demo')),
        h('ul', { class: 'ticks' }, ['Rules enforced on the server', 'Learner & mentor roles', 'Works on any device'].map((t) => h('li', null, Icon('check'), t)))),
      h('div', { class: 'lhero-art' }, demoGraph()));

    const features = h('section', { class: 'lsec', id: 'sec-features' },
      h('div', { class: 'lhead' }, h('span', { class: 'eyebrow' }, 'Everything in one place'), h('h2', null, 'Built for people who actually finish things'), h('p', null, 'From a blank page to a forecasted, mentor-approved study plan.')),
      h('div', { class: 'fgrid' }, FEATURES.map(([ic, col, t, d], i) => scr(h('article', { class: `card tilt feat c-${col}` }, h('div', { class: 'ico' }, Icon(ic)), h('h3', null, t), h('p', null, d)), i % 4))));

    const how = h('section', { class: 'lsec', id: 'sec-how' },
      h('div', { class: 'lhead' }, h('span', { class: 'eyebrow' }, 'How it works'), h('h2', null, 'Three steps to a plan you can trust')),
      h('div', { class: 'steps' }, [
        ['1', 'Map what you need to learn', 'Create a goal, add topics and say what each one depends on. Or let the roadmap generator propose the whole path.'],
        ['2', 'Study, and let the rules guide you', 'Log sessions on unlocked topics. Locked ones explain exactly what is missing. Finish a topic and its dependants open up.'],
        ['3', 'Stay ahead of the deadline', 'Estimates and your recent pace become a forecast, a weekly schedule at your usual times, and a coach that knows where you are.'],
      ].map(([n, t, d], i) => scr(h('div', { class: 'step card' }, h('div', { class: 'num' }, n), h('h3', null, t), h('p', null, d)), i))));

    const ai = h('section', { class: 'lsec', id: 'sec-ai' },
      h('div', { class: 'split' },
        h('div', { class: 'lhead left' }, h('span', { class: 'eyebrow' }, Icon('wand'), 'Roadmap generator'), h('h2', null, 'Don’t start from a blank page'), h('p', null, 'Describe what you want to learn and get a proposed set of topics with prerequisites. Every roadmap — from a template or from Gemini — is validated: no loops, no unknown dependencies, your prerequisite limit respected.'),
          h('p', { class: 'hint' }, 'This try-out uses the built-in templates. Inside the app, roadmaps are written by Gemini when an API key is configured, and always labelled so you know which you got.')),
        scr(roadmapTry())));

    const teams = h('section', { class: 'lsec', id: 'sec-teams' },
      h('div', { class: 'lhead' }, h('span', { class: 'eyebrow' }, 'Mentors & learners'), h('h2', null, 'Made for self-study — and for teaching')),
      h('div', { class: 'roles' },
        scr(h('div', { class: 'card role c-violet' }, h('div', { class: 'ico' }, Icon('book')), h('h3', null, 'For learners'), h('ul', null, ['Deadline warnings per goal', 'Notes & links on every topic', 'Quizzes and a coach that knows your progress', 'A weekly plan at your usual study times', 'Export or share your progress'].map((t) => h('li', null, Icon('check'), t)))), 0),
        scr(h('div', { class: 'card role c-cyan' }, h('div', { class: 'ico' }, Icon('users')), h('h3', null, 'For mentors'), h('ul', null, ['Assign goals to learners or whole cohorts', 'Approve topic completion before dependants unlock', 'See who is at risk across a cohort', 'Create mentors and learners from the People screen', 'Tune the rules — no code changes'].map((t) => h('li', null, Icon('check'), t)))), 1)));

    const cta = scr(h('section', { class: 'lcta-band card' }, h('h2', null, 'Ready to study in the right order?'), h('p', null, 'Create a free account, or open the demo to explore as a learner or a mentor.'), h('div', { class: 'lcta' }, h('a', { class: 'btn primary lg', href: '#/register' }, 'Create your account', Icon('arrow')), h('a', { class: 'btn lg', href: '#/login' }, 'Explore the demo')), window.DEMO_SHARE_TOKEN ? h('p', { class: 'hint', style: { marginTop: '14px' } }, h('a', { href: '#/s/' + window.DEMO_SHARE_TOKEN }, 'See a sample read-only share link →')) : null));

    const foot = h('footer', { class: 'lfoot' }, App.brand(false), h('span', null, 'Pathwise · a study progress tracker with prerequisite rules'));

    const page = h('div', { class: 'pub wide landing' }, nav, hero, features, how, ai, teams, cta, foot);

    // scroll-reveal: elements are only hidden while they are waiting to enter the viewport
    const items = [...page.querySelectorAll('.scr')];
    const showAll = () => items.forEach((el) => el.classList.add('in'));
    if (UI.reduced() || !('IntersectionObserver' in window)) showAll();
    else {
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
      requestAnimationFrame(() => items.forEach((el) => io.observe(el)));
      setTimeout(showAll, 6000); // safety net: never leave content hidden
    }
    return page;
  };
})();
