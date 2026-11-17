/* App shell: public site (landing, sign in, shared links), authenticated shell, hash router, theme. */
(function () {
  'use strict';
  const app = { user: null };
  window.App = app;
  const root = document.getElementById('app');

  /* ---------- theme ---------- */
  const getTheme = () => { try { return localStorage.getItem('spt-theme'); } catch { return null; } };
  const setTheme = (t) => { document.documentElement.dataset.theme = t; try { localStorage.setItem('spt-theme', t); } catch { /* ignore */ } };
  setTheme(getTheme() || 'dark');

  /* ---------- routing ---------- */
  // The current path lives in memory and the URL hash mirrors it, so navigation keeps working even where the
  // hash can't be written or doesn't fire events (sandboxed frames). Back/forward and #/links use the hash.
  let cur = location.hash.replace(/^#/, '') || '/';
  let pending = false;
  app.go = (path) => {
    const same = path === cur;
    cur = path;
    let viaHash = false;
    try {
      if ('#' + path !== location.hash) { location.hash = path; viaHash = true; }
    } catch { /* hash not writable here */ }
    if (viaHash && !same) {
      pending = true; // normally hashchange runs the route; this timer covers frames that never fire it
      setTimeout(() => { if (pending) { pending = false; route(); } }, 80);
    } else route();
  };
  const parse = () => {
    const [path, qs] = cur.split('?');
    return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
  };
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#/"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    app.go(a.getAttribute('href').slice(1));
  });
  let token = 0;
  let current = null;

  let logoSeq = 0;
  const LOGO = () => {
    const t = document.createElement('template');
    const gid = 'lg' + ++logoSeq; // unique per instance: a gradient defined in a display:none copy can't be referenced
    t.innerHTML = '<svg viewBox="0 0 40 40" fill="none"><defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b7cff"/><stop offset="1" stop-color="#3dd9eb"/></linearGradient></defs><rect width="40" height="40" rx="12" fill="url(#' + gid + ')"/><path d="M11 27l7-7 4 4 8-9" stroke="#0a0b20" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="30" cy="15" r="2.6" fill="#0a0b20"/></svg>';
    return t.content.firstChild;
  };
  const brand = (sub) => h('div', { class: 'brand' }, LOGO(), h('div', null, 'Pathwise', sub === false ? null : h('small', null, 'Study tracker')));
  app.brand = brand;

  const aurora = () => document.querySelector('.aurora') || document.body.appendChild(h('div', { class: 'aurora' }, h('i'), h('i'), h('i')));
  const themeBtn = () => h('button', { class: 'icon-btn', 'aria-label': 'Toggle theme', title: 'Toggle theme', onclick: (e) => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; setTheme(t); e.currentTarget.replaceChildren(Icon(t === 'dark' ? 'sun' : 'moon')); } }, Icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'));
  app.themeBtn = themeBtn;

  /* ---------- authenticated shell ---------- */
  function nav() {
    const mentor = app.user.role === 'mentor';
    const is = (...ps) => (p) => ps.some((x) => (x.endsWith('*') ? p.startsWith(x.slice(0, -1)) : p === x));
    const items = mentor
      ? [['/', 'users', 'Learners', (p) => p === '/' || p.startsWith('/learners') || p.startsWith('/goals')], ['/approvals', 'clipboard', 'Approvals', is('/approvals')], ['/assign', 'send', 'Assign goal', is('/assign')], ['/people', 'userplus', 'People', is('/people')], ['/settings', 'sliders', 'Settings', is('/settings')]]
      : [['/', 'home', 'Dashboard', (p) => p === '/' || p.startsWith('/goals') || p === '/roadmap'], ['/log', 'bolt', 'Log session', is('/log')], ['/insights', 'sparkles', 'Weekly plan', is('/insights')], ['/coach', 'message', 'Coach', is('/coach')], ['/settings', 'sliders', 'Settings', is('/settings')]];
    const { path } = parse();
    return h('nav', { class: 'nav', 'aria-label': 'Main' }, items.map(([to, ic, label, active]) => h('a', { href: '#' + to, class: active(path) ? 'active' : '', 'data-to': to }, Icon(ic), h('span', null, label))));
  }
  async function paintBadge() {
    if (!app.user || app.user.role !== 'mentor') return;
    try {
      const n = (await API.approvals()).approvals.length;
      root.querySelectorAll('.nav a[data-to="/approvals"]').forEach((a) => { a.querySelector('.badge') && a.querySelector('.badge').remove(); if (n) a.append(h('em', { class: 'badge' }, n)); });
    } catch { /* ignore */ }
  }
  app.refreshBadge = paintBadge;

  const logoutBtn = () => h('button', { class: 'icon-btn', 'aria-label': 'Sign out', title: 'Sign out', onclick: async () => { try { await API.logout(); } catch { /* ignore */ } app.user = null; app.go('/'); } }, Icon('logout'));

  function shell() {
    aurora();
    root.replaceChildren(
      h('div', { class: 'shell' },
        h('aside', { class: 'side' }, brand(), nav(), h('div', { class: 'spacer' }),
          h('div', { class: 'me' }, h('div', { class: 'avatar' }, UI.initials(app.user.name)), h('div', null, h('b', null, app.user.name), h('span', null, app.user.role)), themeBtn(), logoutBtn())),
        h('main', { class: 'main' },
          h('div', { class: 'mobile-bar' }, brand(), h('div', { class: 'actions' }, themeBtn(), logoutBtn())),
          h('div', { class: 'page', id: 'page' }))));
  }

  const notFound = () => h('div', { class: 'card empty' }, Icon('info'), h('h3', null, 'Page not found'), h('p', null, 'That page doesn’t exist.'), h('div', { style: { marginTop: '14px' } }, h('a', { class: 'btn primary', href: '#/' }, 'Go home')));

  async function route() {
    const { path, query } = parse();
    const my = ++token;
    if (current && current.__cleanup) current.__cleanup();
    UI.drawer.close();
    document.querySelectorAll('.scrim').forEach((s) => s.remove());

    /* a shared read-only link works for everyone, signed in or not */
    let m;
    if ((m = path.match(/^\/s\/([\w-]+)$/))) return publicPage(() => Views.sharedGoal({ token: m[1] }), my);
    if (!app.user) {
      if (path === '/') return publicPage(() => Views.landing(), my, true);
      if (path === '/login' || path === '/register') return authScreen(path === '/register' ? 'register' : 'login');
      return authScreen('login');
    }
    if (path === '/login' || path === '/register') return app.go('/');

    if (!document.getElementById('page')) shell();
    else { root.querySelector('.side nav').replaceWith(nav()); }
    paintBadge();
    const page = document.getElementById('page');
    page.replaceChildren(UI.skeleton(3, 130));
    let view;
    try {
      const mentor = app.user.role === 'mentor';
      if (path === '/') view = await (mentor ? Views.learners() : Views.dashboard({}));
      else if (path === '/log' && !mentor) view = await Views.log();
      else if (path === '/insights' && !mentor) view = await Views.insights({});
      else if (path === '/coach' && !mentor) view = await Views.coach();
      else if (path === '/roadmap' && !mentor) view = await Views.roadmap({ mode: 'learner', query });
      else if (path === '/assign' && mentor) view = await Views.roadmap({ mode: 'assign', query });
      else if (path === '/approvals' && mentor) view = await Views.approvals();
      else if (path === '/people' && mentor) view = await Views.people({ query });
      else if (path === '/settings') view = await Views.settings();
      else if ((m = path.match(/^\/goals\/([\w-]+)$/))) view = await Views.goal({ id: m[1], query });
      else if (mentor && (m = path.match(/^\/learners\/([\w-]+)$/))) view = await Views.dashboard({ learnerId: m[1] });
      else if (mentor && (m = path.match(/^\/learners\/([\w-]+)\/insights$/))) view = await Views.insights({ learnerId: m[1] });
      else view = notFound();
    } catch (err) {
      if (my !== token) return;
      view = h('div', { class: 'card empty' }, Icon('alert'), h('h3', null, err.status === 403 ? 'Not allowed' : err.status === 404 ? 'Not found' : 'Something went wrong'), h('p', null, err.message), h('div', { style: { marginTop: '14px' } }, h('a', { class: 'btn primary', href: '#/' }, 'Back to safety')));
    }
    if (my !== token) return; // a newer navigation superseded this one
    current = view;
    view.classList.add('page-enter');
    page.replaceChildren(view);
    window.scrollTo({ top: 0 });
  }
  window.addEventListener('hashchange', () => { cur = location.hash.replace(/^#/, '') || '/'; pending = false; route(); });

  /* ---------- public pages (no sidebar) ---------- */
  async function publicPage(build, my, wide) {
    aurora();
    root.replaceChildren(h('div', { class: 'pub' + (wide ? ' wide' : '') }, UI.skeleton(2, 200)));
    let view;
    try { view = await build(); } catch (err) {
      view = h('div', { class: 'pub-wrap' }, h('div', { class: 'card empty' }, Icon('alert'), h('h3', null, err.status === 404 ? 'Link not available' : 'Something went wrong'), h('p', null, err.message), h('div', { style: { marginTop: '14px' } }, h('a', { class: 'btn primary', href: '#/' }, 'Go to Pathwise'))));
    }
    if (my !== token) return;
    current = view;
    root.replaceChildren(view);
    window.scrollTo({ top: 0 });
  }

  /* ---------- sign in / create account ---------- */
  function authScreen(startMode) {
    aurora();
    let mode = startMode || 'login';
    const name = h('input', { class: 'input', name: 'name', autocomplete: 'name', placeholder: 'Your name' });
    const email = h('input', { class: 'input', name: 'email', type: 'email', autocomplete: 'email', placeholder: 'you@example.com' });
    const pass = h('input', { class: 'input', name: 'password', type: 'password', autocomplete: 'current-password', placeholder: '••••••••' });
    const submit = h('button', { class: 'btn primary block', type: 'submit' });
    const title = h('h2'), sub = h('p', { class: 'sub', style: { color: 'var(--muted)', marginBottom: '22px' } });
    const nameF = UI.field('Name', name, 'name');
    const form = h('form', { novalidate: true }, nameF, UI.field('Email', email, 'email'), UI.field('Password', pass, 'password'), submit);
    const toggle = h('button', { class: 'btn sm', type: 'button' });
    const demo = h('div', { class: 'demo' }, 'Try a demo:', ...[['Learner', 'learner@demo.com', 'learner123'], ['Mentor', 'mentor@demo.com', 'mentor123'], ['Assigned learner', 'diya@demo.com', 'learner123']].map(([l, e, p]) => h('button', { class: 'btn sm', type: 'button', onclick: () => { email.value = e; pass.value = p; mode = 'login'; paint(); form.requestSubmit(); } }, l)));
    const paint = () => {
      const reg = mode === 'register';
      title.textContent = reg ? 'Create your account' : 'Welcome back';
      sub.textContent = reg ? 'Start mapping what you need to learn — and in what order.' : 'Sign in to continue your study path.';
      nameF.style.display = reg ? '' : 'none';
      submit.replaceChildren(reg ? 'Create account' : 'Sign in', Icon('arrow'));
      toggle.textContent = reg ? 'I already have an account' : 'New here? Create an account';
      pass.autocomplete = reg ? 'new-password' : 'current-password';
      UI.clearErrors(form);
    };
    toggle.addEventListener('click', () => { mode = mode === 'login' ? 'register' : 'login'; paint(); });
    paint();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      UI.clearErrors(form);
      const errs = {};
      if (mode === 'register' && name.value.trim().length < 2) errs.name = 'Enter your name';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) errs.email = 'Enter a valid email';
      if (!pass.value) errs.password = 'Enter your password';
      else if (mode === 'register' && pass.value.length < 8) errs.password = 'At least 8 characters';
      if (Object.keys(errs).length) return Object.entries(errs).forEach(([k, v]) => UI.setFieldError(form, k, v));
      UI.withBusy(submit, async () => {
        try {
          const r = mode === 'login' ? await API.login(email.value, pass.value) : await API.register(name.value, email.value, pass.value);
          app.user = r.user;
          root.replaceChildren();
          pending = false;
          cur = '/';
          try { location.hash = '/'; } catch { /* ignore */ }
          route();
        } catch (err) {
          if (err.status === 401) { UI.setFieldError(form, 'password', err.message); }
          else UI.applyApiError(form, err);
        }
      });
    });
    root.replaceChildren(
      h('div', { class: 'auth' },
        h('section', { class: 'auth-hero' }, h('a', { href: '#/', style: { textDecoration: 'none', color: 'inherit' } }, brand()),
          h('h1', null, 'Study in the ', h('em', null, 'right order.')),
          h('p', null, 'Map every topic, lock what isn’t ready, and unlock the next step the moment you finish a prerequisite. Track time, keep streaks, and get a weekly plan.'),
          Charts.heroArt()),
        h('section', { class: 'auth-panel' }, h('div', { class: 'card auth-card reveal' }, title, sub, form, h('div', { style: { marginTop: '14px', textAlign: 'center' } }, toggle), demo, h('div', { style: { marginTop: '12px', textAlign: 'center' } }, h('a', { class: 'hint', href: '#/' }, '← Back to home'))))));
  }

  /* ---------- boot ---------- */
  async function boot() {
    API.onUnauthorized = () => { if (app.user) { app.user = null; UI.toast('Please sign in again', 'info'); app.go('/login'); } };
    try {
      app.user = (await API.me()).user;
    } catch {
      app.user = null;
    }
    route();
  }
  boot();
})();
