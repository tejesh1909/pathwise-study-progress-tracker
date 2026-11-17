/* Hand-rolled SVG charts with entrance animations: ring, bars, horizontal bars, area line, heatmap, prerequisite graph. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  let uid = 0;
  const nextId = (p) => `${p}${++uid}`;

  /* ---------- progress ring ---------- */
  function ring({ percent, size, stroke, label, fs, color }) {
    size = size || 72;
    stroke = stroke || 8;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const bar = svg('circle', { class: 'bar', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke, 'stroke-dasharray': c, 'stroke-dashoffset': c });
    const el = h('div', { class: `ring${color ? ' c-' + color : ''}`, style: { width: size + 'px', height: size + 'px', '--fs': (fs || Math.round(size * 0.28)) + 'px' }, role: 'img', 'aria-label': `${percent}% complete` },
      svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` }, svg('circle', { class: 'trk', cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': stroke }), bar),
      h('div', { class: 'num' }, label || h('span', null, UI.counter(percent), h('small', null, '%')))
    );
    requestAnimationFrame(() => requestAnimationFrame(() => bar.setAttribute('stroke-dashoffset', c * (1 - Math.min(100, percent) / 100))));
    return el;
  }

  /* ---------- vertical bars ---------- */
  function bars({ data, height, valueFmt, highlightLast }) {
    const W = 520, H = height || 190, pl = 8, pr = 8, pt = 24, pb = 26;
    const max = Math.max(60, ...data.map((d) => d.value));
    const top = Math.ceil(max / 60) * 60;
    const bw = (W - pl - pr) / data.length;
    const gid = nextId('bg');
    const s = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Minutes studied per week' });
    s.append(svg('defs', null, svg('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, svg('stop', { offset: '0%', 'stop-color': 'var(--cyan)' }), svg('stop', { offset: '100%', 'stop-color': 'var(--violet)' }))));
    for (let i = 0; i <= 3; i++) {
      const y = pt + ((H - pt - pb) * i) / 3;
      s.append(svg('line', { class: 'grid-l', x1: pl, x2: W - pr, y1: y, y2: y }));
    }
    data.forEach((d, i) => {
      const bh = Math.max(d.value ? 4 : 0, ((H - pt - pb) * d.value) / top);
      const x = pl + i * bw + bw * 0.18;
      const w = bw * 0.64;
      const y = H - pb - bh;
      const last = highlightLast && i === data.length - 1;
      const g = svg('g', null);
      const rect = svg('rect', { class: 'gbar', x, y, width: w, height: bh, rx: 7, fill: last ? `url(#${gid})` : 'color-mix(in srgb, var(--violet) 55%, transparent)', style: { '--i': i } });
      UI.tip(rect, () => `${d.tip || d.label}: ${valueFmt ? valueFmt(d.value) : d.value}`);
      g.append(rect);
      if (d.value) g.append(svg('text', { x: x + w / 2, y: y - 7, 'text-anchor': 'middle', style: { fill: last ? 'var(--text)' : 'var(--muted)', fontWeight: 600 } }, valueFmt ? valueFmt(d.value) : d.value));
      g.append(svg('text', { x: x + w / 2, y: H - 7, 'text-anchor': 'middle' }, d.label));
      s.append(g);
    });
    return s;
  }

  /* ---------- horizontal bars (minutes per topic) ---------- */
  function hBars({ items, valueFmt }) {
    const wrap = h('div', { class: 'list' });
    const max = Math.max(1, ...items.map((i) => i.value));
    items.forEach((it, i) => {
      wrap.append(
        h('div', { style: { display: 'grid', gap: '5px' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '13px' } },
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.label),
            h('b', { style: { fontFamily: 'var(--display)' } }, valueFmt(it.value))),
          h('div', { class: 'progress' }, h('i', { class: 'hbar', style: { width: (it.value / max) * 100 + '%', background: it.color || 'var(--violet)', '--i': i } }))
        )
      );
    });
    return wrap;
  }

  /* ---------- area / line ---------- */
  function area({ data, height, valueFmt }) {
    const W = 520, H = height || 150, pl = 10, pr = 10, pt = 18, pb = 24;
    const max = Math.max(60, ...data.map((d) => d.value)) * 1.15;
    const step = (W - pl - pr) / Math.max(1, data.length - 1);
    const pts = data.map((d, i) => [pl + i * step, H - pb - ((H - pt - pb) * d.value) / max]);
    const smooth = pts.map((p, i) => {
      if (!i) return `M${p[0]},${p[1]}`;
      const q = pts[i - 1];
      const cx = (q[0] + p[0]) / 2;
      return `C${cx},${q[1]} ${cx},${p[1]} ${p[0]},${p[1]}`;
    }).join(' ');
    const gid = nextId('ag');
    const s = svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Minutes per week' });
    s.append(svg('defs', null, svg('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, svg('stop', { offset: '0%', 'stop-color': 'var(--c, var(--violet))', 'stop-opacity': 0.45 }), svg('stop', { offset: '100%', 'stop-color': 'var(--c, var(--violet))', 'stop-opacity': 0 }))));
    for (let i = 0; i <= 2; i++) {
      const y = pt + ((H - pt - pb) * i) / 2;
      s.append(svg('line', { class: 'grid-l', x1: pl, x2: W - pr, y1: y, y2: y }));
    }
    s.append(svg('path', { class: 'area', d: `${smooth} L${pts[pts.length - 1][0]},${H - pb} L${pts[0][0]},${H - pb} Z`, fill: `url(#${gid})` }));
    const line = svg('path', { class: 'draw', d: smooth, fill: 'none', stroke: 'var(--c, var(--violet))', 'stroke-width': 3, 'stroke-linecap': 'round', style: { '--len': 900 }, 'stroke-dasharray': 900 });
    s.append(line);
    pts.forEach((p, i) => {
      const dot = svg('circle', { cx: p[0], cy: p[1], r: 5, fill: 'var(--bg)', stroke: 'var(--c, var(--violet))', 'stroke-width': 2.5, style: { opacity: 0, animation: `fadeIn .4s ${0.8 + i * 0.1}s forwards` } });
      UI.tip(dot, () => `${data[i].tip || data[i].label}: ${valueFmt(data[i].value)}`);
      s.append(dot);
      s.append(svg('text', { x: p[0], y: H - 6, 'text-anchor': i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle' }, data[i].label));
    });
    return s;
  }

  /* ---------- heatmap ---------- */
  function heatmap(days) {
    const lvl = (m) => (m === 0 ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4);
    const grid = h('div', { class: 'heat', role: 'img', 'aria-label': 'Study activity over the last six weeks' });
    // each row is 7 consecutive days, so every column is the same weekday; label columns from the first date
    const first = days.length ? days[0].date.split('-').map(Number) : [2000, 1, 1];
    const startDow = new Date(Date.UTC(first[0], first[1] - 1, first[2])).getUTCDay();
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((_, i) => grid.append(h('div', { class: 'dow' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][(startDow + i) % 7].slice(0, 2))));
    days.forEach((d, i) => {
      const c = h('i', { 'data-l': lvl(d.minutes), style: { '--i': i } });
      UI.tip(c, () => `${UI.fmtDate(d.date)} · ${d.minutes ? UI.fmtMin(d.minutes) : 'no study'}`);
      grid.append(c);
    });
    return h('div', null, grid, h('div', { class: 'legend' }, 'Less', ...[0, 1, 2, 3, 4].map((l) => h('i', { 'data-l': l, style: { background: l === 0 ? '' : l === 4 ? 'var(--cyan)' : `color-mix(in srgb, var(--violet) ${[0, 30, 55, 80][l]}%, var(--surface-2))` } })), 'More'));
  }

  /* ---------- prerequisite graph ---------- */
  const NODE_W = 202, NODE_H = 62, GAP_X = 40, GAP_Y = 30, PAD = 24;
  const ICON_PATH = { complete: 'M5 12.5l4.5 4.5L19 7.5', locked: 'M8 11V8a4 4 0 018 0v3M5 11h14v10H5z', in_progress: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z', available: 'M7 5l12 7-12 7z', pending: 'M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9' };

  function layout(topics) {
    const byId = new Map(topics.map((t) => [t.id, t]));
    const depth = new Map();
    const visit = (t, stack) => {
      if (depth.has(t.id)) return depth.get(t.id);
      if (stack.has(t.id)) return 0; // defensive: server never allows loops
      stack.add(t.id);
      const d = t.prerequisites.length ? 1 + Math.max(...t.prerequisites.map((p) => (byId.get(p) ? visit(byId.get(p), stack) : -1))) : 0;
      stack.delete(t.id);
      depth.set(t.id, d);
      return d;
    };
    topics.forEach((t) => visit(t, new Set()));
    const cols = [];
    topics.forEach((t) => (cols[depth.get(t.id)] = cols[depth.get(t.id)] || []).push(t));
    // order each column by the average row of its prerequisites to reduce crossings
    const row = new Map();
    cols.forEach((col, ci) => {
      if (ci > 0) col.sort((a, b) => avg(a) - avg(b));
      col.forEach((t, i) => row.set(t.id, i));
      function avg(t) {
        const rs = t.prerequisites.map((p) => row.get(p)).filter((x) => x != null);
        return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
      }
    });
    const maxRows = Math.max(...cols.map((c) => c.length));
    const H = maxRows * NODE_H + (maxRows - 1) * GAP_Y + PAD * 2;
    const W = cols.length * NODE_W + (cols.length - 1) * GAP_X + PAD * 2;
    const pos = new Map();
    cols.forEach((col, ci) => {
      const colH = col.length * NODE_H + (col.length - 1) * GAP_Y;
      col.forEach((t, i) => pos.set(t.id, { x: PAD + ci * (NODE_W + GAP_X), y: (H - colH) / 2 + i * (NODE_H + GAP_Y) }));
    });
    return { pos, W, H, depth };
  }

  function related(topics, id) {
    const byId = new Map(topics.map((t) => [t.id, t]));
    const set = new Set([id]);
    const up = (x) => byId.get(x) && byId.get(x).prerequisites.forEach((p) => !set.has(p) && (set.add(p), up(p)));
    const down = (x) => topics.forEach((t) => t.prerequisites.includes(x) && !set.has(t.id) && (set.add(t.id), down(t.id)));
    up(id);
    down(id);
    return set;
  }

  function topicGraph({ topics, selectedId, fresh, done, onSelect }) {
    if (!topics.length) return h('div', { class: 'empty' }, Icon('graph'), h('p', null, 'No topics yet — add the first one to start building the map.'));
    const { pos, W, H: baseH, depth } = layout(topics);
    const TOP = 34; // headroom so arcs that hop over intermediate nodes stay inside the canvas
    const H = baseH + TOP;
    const byId = new Map(topics.map((t) => [t.id, t]));
    const s = svg('svg', { class: 'graph', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Topic prerequisite map', style: { width: '100%', maxWidth: W + 'px', minWidth: Math.min(W, 680) + 'px', height: 'auto' } });
    const edges = [];
    const edgeLayer = svg('g');
    topics.forEach((t) => {
      t.prerequisites.forEach((pid) => {
        const a = pos.get(pid), b = pos.get(t.id);
        if (!a || !b) return;
        const x1 = a.x + NODE_W, y1 = a.y + TOP + NODE_H / 2, x2 = b.x, y2 = b.y + TOP + NODE_H / 2;
        const dx = Math.max(30, (x2 - x1) / 2);
        // an edge that skips columns arcs over the nodes in between instead of running through them
        const hop = (depth.get(t.id) || 0) - (depth.get(pid) || 0) > 1 ? -(NODE_H * 0.95) : 0;
        const p = svg('path', { class: `edge${byId.get(pid).complete ? ' done' : ''}`, d: `M${x1},${y1} C${x1 + dx},${y1 + hop} ${x2 - dx},${y2 + hop} ${x2},${y2}` });
        edgeLayer.append(p);
        edges.push({ from: pid, to: t.id, el: p });
      });
    });
    s.append(edgeLayer);
    const nodes = new Map();
    topics.forEach((t, i) => {
      const { x, y } = pos.get(t.id);
      const title = t.title.length > 22 ? t.title.slice(0, 21) + '…' : t.title;
      const sub = t.state === 'locked' ? `Needs ${t.missing.length} more` : t.state === 'complete' ? 'Complete' : t.state === 'pending' ? 'Awaiting approval' : t.minutes ? UI.fmtMin(t.minutes) + ' studied' : 'Ready to start';
      // Outer <g> carries the position (SVG transform attribute); the inner <g> carries the CSS animation.
      // Animating `transform` on the positioned element would override the attribute and stack every node at 0,0.
      const g = svg('g', { class: `node ${t.state}${selectedId === t.id ? ' sel' : ''}${fresh && fresh.has(t.id) ? ' just-unlocked' : ''}${done && done.has(t.id) ? ' just-done' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${t.title}, ${UI.STATE_LABEL[t.state]}`, style: { animation: `fadeUp .6s ${i * 60}ms var(--ease) both` } },
        svg('title', null, t.title),
        svg('rect', { width: NODE_W, height: NODE_H, rx: 16, fill: 'var(--bg-2)' }),
        svg('rect', { class: 'body', width: NODE_W, height: NODE_H, rx: 16 }),
        svg('rect', { class: 'stripe', x: 0, y: 14, width: 4, height: NODE_H - 28, rx: 2, fill: 'var(--c)' }),
        svg('circle', { cx: 30, cy: NODE_H / 2, r: 15, fill: 'color-mix(in srgb, var(--c) 18%, transparent)' }),
        svg('g', { transform: `translate(${30 - 8},${NODE_H / 2 - 8}) scale(.67)`, fill: 'none', stroke: 'var(--c)', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg('path', { d: ICON_PATH[t.state] })),
        svg('text', { x: 54, y: 26 }, title),
        svg('text', { class: 'sm', x: 54, y: 44 }, sub)
      );
      const holder = svg('g', { transform: `translate(${x},${y + TOP})` }, g);
      g.addEventListener('click', () => onSelect(t));
      g.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(t)));
      const hl = (on) => {
        const rel = on ? related(topics, t.id) : null;
        nodes.forEach((n, id) => n.classList.toggle('dim', !!rel && !rel.has(id)));
        edges.forEach((e) => {
          const hot = !!rel && rel.has(e.from) && rel.has(e.to);
          e.el.classList.toggle('hot', hot);
          e.el.classList.toggle('dim', !!rel && !hot);
        });
      };
      g.addEventListener('pointerenter', () => hl(true));
      g.addEventListener('pointerleave', () => hl(false));
      g.addEventListener('focus', () => hl(true));
      g.addEventListener('blur', () => hl(false));
      nodes.set(t.id, g);
      s.append(holder);
    });
    return h('div', null, h('div', { class: 'graph-wrap' }, s),
      h('div', { class: 'gkey' },
        h('span', null, h('i', { style: { background: 'var(--mint)' } }), 'Complete'),
        h('span', null, h('i', { style: { background: 'var(--amber)' } }), 'In progress'),
        h('span', null, h('i', { style: { background: 'var(--cyan)' } }), 'Ready'),
        h('span', null, h('i', { style: { background: 'var(--locked)' } }), 'Locked'),
        h('span', null, 'Arrows point from a prerequisite to the topic it unlocks · hover to trace a path')));
  }

  /* ---------- login art: little graph that locks and unlocks ---------- */
  function heroArt() {
    const nodes = [[40, 130, 'Basics'], [200, 50, 'Core'], [200, 210, 'Practice'], [370, 130, 'Mastery']];
    const edges = [[0, 1], [0, 2], [1, 3], [2, 3]];
    const s = svg('svg', { class: 'auth-art', viewBox: '0 0 520 280', 'aria-hidden': 'true' });
    edges.forEach(([a, b], i) => {
      const A = nodes[a], B = nodes[b];
      s.append(svg('path', { class: 'edge done', style: { animationDelay: i * 0.2 + 's' }, d: `M${A[0] + 110},${A[1] + 28} C${A[0] + 170},${A[1] + 28} ${B[0] - 60},${B[1] + 28} ${B[0]},${B[1] + 28}` }));
    });
    nodes.forEach(([x, y, label], i) => {
      const locked = i === 3;
      const kind = locked ? 'locked' : i === 0 ? 'complete' : 'available';
      s.append(svg('g', { transform: `translate(${x},${y})` },
        svg('g', { class: `node ${kind}`, style: { animation: `fadeUp .8s ${i * 150}ms var(--ease) both` } },
          svg('rect', { width: 110, height: 56, rx: 16, fill: 'var(--bg-2)' }),
          svg('rect', { class: 'body', width: 110, height: 56, rx: 16 }),
          svg('circle', { cx: 28, cy: 28, r: 13, fill: 'color-mix(in srgb, var(--c) 20%, transparent)' }),
          svg('g', { transform: 'translate(20,20) scale(.67)', fill: 'none', stroke: 'var(--c)', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, svg('path', { d: ICON_PATH[kind] })),
          svg('text', { x: 50, y: 33 }, label))));
    });
    return s;
  }

  window.Charts = { ring, bars, hBars, area, heatmap, topicGraph, heroArt };
})();
