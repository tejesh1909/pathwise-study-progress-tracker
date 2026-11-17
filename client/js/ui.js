/* UI toolkit: DOM helpers, icons, toasts, modals, drawer, confetti, count-up, tooltips. No dependencies. */
(function () {
  'use strict';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- tiny hyperscript ---------- */
  function applyProps(el, props) {
    let value;
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) (sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv));
      } else if (k === 'value') value = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    return value;
  }
  function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
  }
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    const value = applyProps(el, props);
    append(el, kids);
    if (value !== undefined) el.value = value;
    return el;
  }
  function svg(tag, props, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    applyProps(el, props);
    append(el, kids);
    return el;
  }

  /* ---------- icons ---------- */
  const ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 3v4M17 5h4"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.5c2.2.6 3.5 2.6 3.5 5.5"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 017.6-1.7"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 1.5 1 2.5 2 2.5 0-3-1-5 1-8.5z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    logout: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
    moon: '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>',
    book: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
    alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    graph: '<circle cx="5" cy="12" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M7.5 12H12l5-5M12 12l5 5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    link: '<path d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
    userplus: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M19 8v6M16 11h6"/>',
    send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
    message: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V3h6v1M9 11l2 2 4-4M9 17h6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
    hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    wand: '<path d="M5 19L17 7M15 5l4 4M6 4v3M4.5 5.5h3M19 15v3M17.5 16.5h3"/>',
    trending: '<path d="M3 17l6-6 4 4 8-9M15 6h6v6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  };
  function Icon(name) {
    const t = document.createElement('template');
    t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    return t.content.firstChild;
  }
  const STATE_ICON = { complete: 'check', locked: 'lock', in_progress: 'clock', available: 'play', pending: 'hourglass' };
  const STATE_LABEL = { complete: 'Complete', locked: 'Locked', in_progress: 'In progress', available: 'Ready', pending: 'Awaiting approval' };
  const stateIcon = (s) => h('span', { class: `sico ${s}` }, Icon(STATE_ICON[s]));
  const pill = (s) => h('span', { class: `pill ${s}` }, Icon(STATE_ICON[s]), STATE_LABEL[s]);

  /* ---------- formatting ---------- */
  const fmtMin = (m) => {
    m = Math.round(m || 0);
    if (m < 60) return `${m}m`;
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${hh}h ${mm}m` : `${hh}h`;
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = (s) => {
    if (!s) return '';
    const [y, m, d] = s.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]}`;
  };
  const dayDiff = (a, b) => Math.round((Date.UTC(...a.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...b.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 86400000);
  const relDay = (date, today) => {
    const d = dayDiff(today, date);
    return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? `${d} days ago` : fmtDate(date);
  };
  const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
  const greeting = () => {
    const hr = new Date().getHours();
    return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  };

  /* ---------- deadline forecast ---------- */
  const FC_LABEL = { on_track: 'On track', at_risk: 'At risk', behind: 'Behind', stalled: 'Stalled', overdue: 'Overdue', done: 'Done', no_target: 'No target', empty: 'No topics' };
  const FC_COLOR = { on_track: 'mint', at_risk: 'amber', behind: 'rose', stalled: 'rose', overdue: 'rose', done: 'mint', no_target: 'sky', empty: 'sky' };
  const forecastChip = (f) => f && f.status !== 'empty' && f.status !== 'no_target' ? h('span', { class: `fc c-${FC_COLOR[f.status]}`, title: f.headline }, Icon(f.status === 'on_track' || f.status === 'done' ? 'trending' : 'alert'), FC_LABEL[f.status]) : null;

  /* ---------- count-up ---------- */
  function countUp(el, to, opts) {
    const o = Object.assign({ dur: 1200, fmt: (n) => String(Math.round(n)) }, opts);
    if (reduced() || !to) {
      el.textContent = o.fmt(to || 0);
      return;
    }
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / o.dur);
      const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      el.textContent = o.fmt(to * e);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  const counter = (to, opts) => {
    const el = h('span', null, (opts && opts.fmt ? opts.fmt(0) : '0'));
    requestAnimationFrame(() => countUp(el, to, opts));
    return el;
  };

  /* ---------- toast ---------- */
  function toast(message, type) {
    let box = document.querySelector('.toasts');
    if (!box) {
      box = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
      document.body.append(box);
    }
    const t = type || 'ok';
    const el = h('div', { class: `toast ${t}` }, Icon(t === 'ok' ? 'check' : t === 'err' ? 'alert' : 'info'), h('span', null, message));
    box.append(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 380);
    }, t === 'err' ? 5200 : 3200);
  }

  /* ---------- modal ---------- */
  /** build(close) must return an element. Esc / scrim click closes. */
  function modal(build, onDismiss) {
    const prev = document.activeElement;
    const scrim = h('div', { class: 'scrim' });
    const close = () => {
      if (!scrim.isConnected) return;
      scrim.remove();
      if (onDismiss) onDismiss();
      document.removeEventListener('keydown', onKey);
      if (prev && prev.focus) prev.focus();
    };
    const onKey = (e) => e.key === 'Escape' && close();
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, build(close));
    scrim.append(box);
    scrim.addEventListener('pointerdown', (e) => e.target === scrim && close());
    document.addEventListener('keydown', onKey);
    document.body.append(scrim);
    const first = box.querySelector('input,select,textarea,button');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 60);
    return { close };
  }
  function confirmDialog({ title, body, confirmLabel, danger, icon }) {
    return new Promise((resolve) => {
      modal(
        (close) =>
          h('div', null,
            h('h2', null, title),
            h('div', { class: 'sub', style: { marginTop: '8px' } }, body),
            h('div', { class: 'foot' },
              h('button', { class: 'btn', onclick: () => { resolve(false); close(); } }, 'Cancel'),
              h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { resolve(true); close(); } }, icon ? Icon(icon) : null, confirmLabel || 'Confirm')
            )
          ),
        () => resolve(false) // dismissed via Esc / click-outside (a second resolve is ignored)
      );
    });
  }

  /* ---------- drawer ---------- */
  const drawer = (() => {
    let wrap, panel, onClose;
    const ensure = () => {
      if (wrap) return;
      panel = h('aside', { class: 'drawer', 'aria-label': 'Topic details' });
      wrap = h('div', { class: 'drawer-wrap' }, panel);
      wrap.addEventListener('pointerdown', (e) => e.target === wrap && api.close());
      document.addEventListener('keydown', (e) => e.key === 'Escape' && wrap.classList.contains('on') && !document.querySelector('.scrim') && api.close());
      document.body.append(wrap);
    };
    const api = {
      open(node, closeCb) {
        ensure();
        onClose = closeCb;
        panel.replaceChildren(h('button', { class: 'icon-btn x', onclick: () => api.close(), 'aria-label': 'Close' }, Icon('x')), node);
        requestAnimationFrame(() => wrap.classList.add('on'));
      },
      replace(node) {
        if (!wrap || !wrap.classList.contains('on')) return;
        const st = panel.scrollTop;
        panel.replaceChildren(h('button', { class: 'icon-btn x', onclick: () => api.close(), 'aria-label': 'Close' }, Icon('x')), node);
        panel.scrollTop = st;
      },
      close() {
        if (!wrap) return;
        wrap.classList.remove('on');
        if (onClose) onClose();
        onClose = null;
      },
      isOpen: () => !!wrap && wrap.classList.contains('on'),
    };
    return api;
  })();

  /* ---------- confetti ---------- */
  function confetti(x, y) {
    if (reduced()) return;
    let cv = document.getElementById('confetti');
    if (!cv) {
      cv = h('canvas', { id: 'confetti' });
      document.body.append(cv);
    }
    const dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const colors = ['#8b7cff', '#3dd9eb', '#3ddc97', '#ffc857', '#ff6b8b', '#ffffff'];
    const ox = x == null ? innerWidth / 2 : x;
    const oy = y == null ? innerHeight / 2 : y;
    const parts = Array.from({ length: 110 }, () => {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 9;
      return { x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 5, r: 3 + Math.random() * 5, c: colors[(Math.random() * colors.length) | 0], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, life: 1 };
    });
    let last = performance.now();
    const frame = (t) => {
      const dt = Math.min(2, (t - last) / 16.7);
      last = t;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      let alive = 0;
      for (const p of parts) {
        p.vy += 0.22 * dt;
        p.vx *= 0.985;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.life -= 0.0075 * dt;
        if (p.life <= 0) continue;
        alive++;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        ctx.restore();
      }
      if (alive) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
    requestAnimationFrame(frame);
  }

  /* ---------- tooltip ---------- */
  let tipEl;
  function tip(el, textFn) {
    el.addEventListener('pointerenter', () => {
      if (!tipEl) {
        tipEl = h('div', { class: 'tip' });
        document.body.append(tipEl);
      }
      tipEl.textContent = typeof textFn === 'function' ? textFn() : textFn;
      tipEl.classList.add('on');
    });
    el.addEventListener('pointermove', (e) => {
      if (tipEl) {
        tipEl.style.left = e.clientX + 'px';
        tipEl.style.top = e.clientY + 'px';
      }
    });
    el.addEventListener('pointerleave', () => tipEl && tipEl.classList.remove('on'));
  }

  /* ---------- forms ---------- */
  function field(label, control, name, hint) {
    return h('div', { class: 'field', 'data-name': name }, label ? h('label', null, label) : null, control, hint ? h('div', { class: 'hint' }, hint) : null, h('div', { class: 'err' }));
  }
  function setFieldError(root, name, message) {
    const f = root.querySelector(`.field[data-name="${name}"]`);
    if (!f) return false;
    f.classList.add('invalid');
    f.querySelector('.err').textContent = message;
    // restart shake
    f.classList.remove('shake');
    void f.offsetWidth;
    return true;
  }
  function clearErrors(root) {
    root.querySelectorAll('.field.invalid').forEach((f) => f.classList.remove('invalid'));
  }
  /** Shows server-side field errors inline; returns true if at least one was placed. */
  function applyApiError(root, err) {
    clearErrors(root);
    const fields = (err && err.details && err.details.fields) || {};
    let placed = false;
    for (const [name, msg] of Object.entries(fields)) placed = setFieldError(root, name, msg) || placed;
    if (!placed) toast(err.message || 'Something went wrong', 'err');
    return placed;
  }
  async function withBusy(btn, fn) {
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      return await fn();
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- global delegated effects ---------- */
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest && e.target.closest('.card.tilt');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', e.clientX - r.left + 'px');
    card.style.setProperty('--my', e.clientY - r.top + 'px');
  });
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('.btn');
    if (!b || reduced() || b.disabled) return;
    const r = b.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const rip = h('span', { class: 'ripple', style: { width: size + 'px', height: size + 'px', left: e.clientX - r.left - size / 2 + 'px', top: e.clientY - r.top - size / 2 + 'px' } });
    b.append(rip);
    setTimeout(() => rip.remove(), 700);
  });

  /** Stagger entrance of the given elements. */
  const stagger = (els) => els.forEach((el, i) => { el.classList.add('reveal'); el.style.setProperty('--i', i); });
  const skeleton = (n, height) => h('div', { class: 'grid' }, Array.from({ length: n || 3 }, () => h('div', { class: 'skeleton', style: { height: (height || 120) + 'px' } })));

  window.h = h;
  window.svg = svg;
  window.Icon = Icon;
  window.UI = { reduced, toast, modal, confirm: confirmDialog, drawer, confetti, countUp, counter, tip, field, setFieldError, clearErrors, applyApiError, withBusy, stagger, skeleton, fmtMin, fmtDate, relDay, dayDiff, initials, greeting, stateIcon, pill, STATE_LABEL, forecastChip, FC_COLOR, FC_LABEL };
})();
