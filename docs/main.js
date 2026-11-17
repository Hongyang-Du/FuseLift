(() => {
  'use strict';

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const SANS = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

  // ── theme tokens (read from CSS so light and dark stay in one place) ──
  const T = {};
  const readTheme = () => {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['bg', 'card', 'ink', 'ink-2', 'muted', 'line', 'blue', 'blue-fill', 'blue-soft',
      'amber', 'red', 'purple', 'teal', 'dot', 'gray']) T[k] = cs.getPropertyValue('--' + k).trim();
  };
  readTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readTheme);

  // ── seeded randomness, so every visitor sees the same picture ──
  const rng = seed => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = r => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());

  // ── tweened parameter sets ──
  class Tween {
    constructor(v) { this.from = { ...v }; this.to = { ...v }; this.t0 = 0; this.d = 0; }
    get() {
      const k = this.d ? ease(clamp((performance.now() - this.t0) / this.d)) : 1;
      const o = {};
      for (const key in this.to) o[key] = lerp(this.from[key], this.to[key], k);
      return o;
    }
    set(v, d = 900) { this.from = this.get(); this.to = { ...v }; this.t0 = performance.now(); this.d = reduce ? 0 : d; }
  }

  // ── canvas mounting: crisp at any DPR, only animates while on screen ──
  const loops = [];
  function mountCanvas(canvas, heightFor, draw) {
    const ctx = canvas.getContext('2d');
    const st = { w: 0, h: 0, visible: false };
    const render = now => { ctx.clearRect(0, 0, st.w, st.h); draw(ctx, st.w, st.h, reduce ? 0 : now / 1000); };
    const resize = () => {
      const w = canvas.clientWidth;
      if (!w) return;
      const h = Math.round(heightFor(w));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.height = h + 'px';
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      st.w = w; st.h = h;
      render(performance.now());
    };
    new ResizeObserver(resize).observe(canvas.parentElement);
    new IntersectionObserver(es => { st.visible = es[0].isIntersecting; }, { rootMargin: '120px' }).observe(canvas);
    loops.push(now => { if (st.visible) render(now); });
    resize();
    return st;
  }
  const tick = now => { for (const f of loops) f(now); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);

  // ── segmented controls, with optional auto-advance until the reader takes over ──
  function segmented(fig, attr, onChange, autoMs) {
    const buttons = $$(`.seg button[data-${attr}]`, fig);
    let i = 0, touched = false, visible = false;
    const pick = (j, user) => {
      i = j;
      buttons.forEach((b, k) => b.setAttribute('aria-pressed', k === j));
      onChange(buttons[j].dataset[attr], user);
    };
    buttons.forEach((b, j) => b.addEventListener('click', () => { touched = true; pick(j, true); }));
    if (autoMs && !reduce) {
      new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0.4 }).observe(fig);
      setInterval(() => { if (visible && !touched && !document.hidden) pick((i + 1) % buttons.length, false); }, autoMs);
    }
    return pick;
  }
  function setStatus(fig, text) {
    const el = $('[data-status]', fig);
    if (!el || el.textContent === text) return;
    if (reduce) { el.textContent = text; return; }
    el.classList.add('swap');
    setTimeout(() => { el.textContent = text; el.classList.remove('swap'); }, 220);
  }

  // ════════════════════════════════════════════════════════════════════
  //  The shared picture: decoder tolerance vs generator error
  // ════════════════════════════════════════════════════════════════════
  const TILT = -25 * Math.PI / 180;
  const BASE = { a: 1.72, b: 0.60, ru: 1.02, rv: 1.02, ghostTol: 0, ghostErr: 0 };
  const REG = { a: 1.48, b: 1.20, ru: 1.02, rv: 1.02, ghostTol: 1, ghostErr: 0 };
  const LIFT = { a: 1.72, b: 0.60, ru: 1.32, rv: 0.44, ghostTol: 0, ghostErr: 1 };
  const DOTS = Array.from({ length: 40 }, (_, i) => {
    const r = Math.sqrt((i + 0.5) / 40) * 0.94, th = i * 2.39996323;
    return { x: r * Math.cos(th), y: r * Math.sin(th), ph: i * 1.7 };
  });

  function arrow(ctx, x0, y0, x1, y1, color, lw = 3.2) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 6) return;
    const ux = dx / L, uy = dy / L, head = Math.min(13, L * 0.6);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round';
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - ux * head * 0.8, y1 - uy * head * 0.8); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * head - uy * head * 0.5, y1 - uy * head + ux * head * 0.5);
    ctx.lineTo(x1 - ux * head + uy * head * 0.5, y1 - uy * head - ux * head * 0.5);
    ctx.closePath(); ctx.fill();
  }
  function cleanLatent(ctx, x, y) {
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fillStyle = T.card; ctx.fill();
    ctx.lineWidth = 2.6; ctx.strokeStyle = T.dot; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 3.4, 0, 7); ctx.fillStyle = T.dot; ctx.fill();
  }

  // p: {a, b} tolerance semi-axes, {ru, rv} error contour, ghost* fade the "before" outline.
  function drawInterface(ctx, cx, cy, s, p, time, o = {}) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(TILT);
    ctx.lineJoin = 'round';

    if (p.ghostTol > 0.01) {
      ctx.globalAlpha = p.ghostTol; ctx.setLineDash([6, 6]); ctx.lineWidth = 2; ctx.strokeStyle = T['blue-soft'];
      ctx.beginPath(); ctx.ellipse(0, 0, BASE.a * s, BASE.b * s, 0, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.ellipse(0, 0, p.a * s, p.b * s, 0, 0, 7);
    ctx.fillStyle = T['blue-fill']; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
    ctx.lineWidth = 3.2; ctx.strokeStyle = T.blue; ctx.stroke();
    if (p.ghostTol > 0.01) {   // the old outline stays readable on top of the new fill
      ctx.globalAlpha = p.ghostTol * 0.9; ctx.setLineDash([6, 6]); ctx.lineWidth = 2; ctx.strokeStyle = T['blue-soft'];
      ctx.beginPath(); ctx.ellipse(0, 0, BASE.a * s, BASE.b * s, 0, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const showErr = o.err === undefined ? 1 : o.err;
    if (showErr > 0.01) {
      if (p.ghostErr > 0.01) {
        ctx.globalAlpha = p.ghostErr * 0.55 * showErr; ctx.setLineDash([5, 6]); ctx.lineWidth = 2; ctx.strokeStyle = T.gray;
        ctx.beginPath(); ctx.arc(0, 0, BASE.ru * s, 0, 7); ctx.stroke();
      }
      ctx.globalAlpha = showErr;
      ctx.setLineDash([8, 7]); ctx.lineWidth = 2.4; ctx.strokeStyle = T.dot;
      ctx.beginPath(); ctx.ellipse(0, 0, p.ru * s, p.rv * s, 0, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      for (const d of DOTS) {
        const x = p.ru * (d.x + 0.04 * Math.sin(time * 0.9 + d.ph));
        const y = p.rv * (d.y + 0.04 * Math.cos(time * 0.7 + d.ph * 1.3));
        const out = (x / p.a) ** 2 + (y / p.b) ** 2 > 1;
        const px = x * s, py = y * s;
        if (out) {
          ctx.strokeStyle = T.red; ctx.lineWidth = 3; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(px - 6, py - 6); ctx.lineTo(px + 6, py + 6);
          ctx.moveTo(px + 6, py - 6); ctx.lineTo(px - 6, py + 6); ctx.stroke();
        } else {
          ctx.fillStyle = T.dot; ctx.beginPath(); ctx.arc(px, py, 4.4, 0, 7); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    const ru = o.arrowU === undefined ? p.ru : o.arrowU, rv = o.arrowV === undefined ? p.rv : o.arrowV;
    arrow(ctx, 0, 0, ru * s * 0.98, 0, T.teal);
    arrow(ctx, 0, 0, 0, -rv * s * 0.98, T.purple);
    cleanLatent(ctx, 0, 0);
    ctx.restore();
  }

  // ── 1. interface figure ──
  (() => {
    const fig = $('#viz-interface'); if (!fig) return;
    const P = new Tween(BASE);
    const text = {
      baseline: 'The error leaks out of what the decoder tolerates.',
      fusereg: 'FuseReg widens the tolerance.',
      fuselift: 'FuseLift reshapes the error.',
    };
    const params = { baseline: BASE, fusereg: REG, fuselift: LIFT };
    const stack = $('.stack', fig);
    stack.classList.add('bad');
    segmented(fig, 'mode', mode => {
      P.set(params[mode]);
      setStatus(fig, text[mode]);
      $$('img[data-gen]', fig).forEach(im => im.classList.toggle('on', im.dataset.gen === mode));
      stack.classList.toggle('bad', mode === 'baseline');
    }, 4600);
    mountCanvas($('canvas', fig), w => clamp(w * 0.58, 280, 350), (ctx, w, h, t) => {
      const s = Math.min(w / 3.9, h / 2.75);
      drawInterface(ctx, w / 2, h / 2, s, P.get(), t);
    });
  })();

  // ── 2. FuseReg: random layer subsets widen the tolerance ──
  (() => {
    const fig = $('#viz-fusereg'); if (!fig) return;
    const K = 23, VIEWS = 12, CYCLE = 1.25, HOLD = 4.2, RESET = 1.1, TOTAL = VIEWS * CYCLE + HOLD + RESET;
    // per-layer deviation from the all-layer mean; they sum to zero, as in the paper
    const r0 = rng(11);
    const dev = Array.from({ length: K }, (_, i) => ({ u: 0.75 * gauss(r0), v: (2.3 - 1.5 * i / (K - 1)) * gauss(r0) }));
    const mu = dev.reduce((m, d) => ({ u: m.u + d.u / K, v: m.v + d.v / K }), { u: 0, v: 0 });
    dev.forEach(d => { d.u -= mu.u; d.v -= mu.v; });
    const makeViews = loop => {
      const r = rng(100 + loop), views = [];
      while (views.length < VIEWS) {
        const S = []; for (let i = 0; i < K; i++) if (r() < 0.2) S.push(i);
        if (!S.length) continue;
        let u = 0, v = 0; S.forEach(i => { u += dev[i].u / S.length; v += dev[i].v / S.length; });
        u *= 0.9; v *= 0.9;
        const q = Math.sqrt((u / (REG.a * 0.9)) ** 2 + (v / (REG.b * 0.9)) ** 2);   // keep every view inside the final tolerance
        if (q > 1) { u /= q; v /= q; }
        views.push({ S, u, v });
      }
      return views;
    };
    const shade = i => { const k = i / (K - 1); const c = (a, b) => Math.round(lerp(a, b, k)); return `rgb(${c(206, 88)},${c(212, 101)},${c(221, 120)})`; };
    let loop = -1, views = [], phase = '';

    const cell = w => { const gap = w < 520 ? 3 : 6, cw = Math.min(36, (w - 32 - gap * (K - 1)) / K); return { gap, cw, ch: clamp(cw * 1.25, 24, 40) }; };
    mountCanvas($('canvas', fig), w => 14 + cell(w).ch + 48 + 2.6 * Math.min(w / 4.3, 100) + 14, (ctx, w, h, time) => {
      const t = reduce ? VIEWS * CYCLE + 2 : time % TOTAL, L = reduce ? 0 : Math.floor(time / TOTAL);
      if (L !== loop) { loop = L; views = makeViews(L); }
      const training = t < VIEWS * CYCLE;
      const idx = training ? Math.floor(t / CYCLE) : VIEWS, q = training ? (t - idx * CYCLE) / CYCLE : 1;
      const tt = t - VIEWS * CYCLE;                       // time into the test phase
      const resetK = tt > HOLD ? ease(clamp((tt - HOLD) / RESET)) : 0;
      const ph = training ? 'train' : 'test';
      if (ph !== phase) { phase = ph; setStatus(fig, training ? 'Training: average a random subset of layers.' : 'Test time: all layers, as always. The tolerance has widened.'); }

      // layer strip
      const { gap, cw, ch } = cell(w);
      const x0 = (w - (cw * K + gap * (K - 1))) / 2, y0 = 14;
      const kept = training ? new Set(views[idx].S) : null;
      const pop = training ? Math.sin(clamp(q / 0.3) * Math.PI) * 3 : 0;
      for (let i = 0; i < K; i++) {
        const on = training ? kept.has(i) : true, x = x0 + i * (cw + gap);
        ctx.beginPath(); ctx.roundRect(x, y0 - (on ? pop : 0), cw, ch, Math.min(7, cw / 4));
        if (on) { ctx.fillStyle = shade(i); ctx.globalAlpha = 1 - resetK * 0.2; ctx.fill(); }
        else { ctx.setLineDash([3, 3]); ctx.lineWidth = 1.4; ctx.strokeStyle = T.gray; ctx.globalAlpha = 0.7; ctx.stroke(); ctx.setLineDash([]); }
        ctx.globalAlpha = 1;
      }
      ctx.font = `400 16px ${SANS}`; ctx.fillStyle = T.muted; ctx.textBaseline = 'top';
      ctx.textAlign = 'left'; ctx.fillText('shallow', x0, y0 + ch + 10);
      ctx.textAlign = 'right'; ctx.fillText('deep', x0 + cw * K + gap * (K - 1), y0 + ch + 10);

      // tolerance plot
      const s = Math.min(w / 4.3, 100), cx = w / 2, cy = y0 + ch + 48 + 1.3 * s;
      const grow = training ? ease(clamp((idx + clamp((q - 0.3) / 0.5)) / VIEWS)) : 1 - resetK;
      const p = { a: lerp(BASE.a, REG.a, grow), b: lerp(BASE.b, REG.b, grow), ru: 1.02, rv: 1.02, ghostTol: grow, ghostErr: 0 };
      const errIn = training ? 0 : clamp(tt / 0.9) * (1 - resetK);
      drawInterface(ctx, cx, cy, s, p, time, { err: errIn, arrowU: 0.95, arrowV: 0.95 });

      // training views
      const place = v => { const c = Math.cos(TILT), sn = Math.sin(TILT), x = v.u * s, y = -v.v * s; return [cx + x * c - y * sn, cy + x * sn + y * c]; };
      const diamond = (x, y, a) => {
        ctx.globalAlpha = a; ctx.fillStyle = T.amber; ctx.strokeStyle = T.card; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 9, y); ctx.closePath();
        ctx.fill(); ctx.stroke(); ctx.globalAlpha = 1;
      };
      const settled = training ? 1 : lerp(1, 0.4, clamp(tt / 0.9)) * (1 - resetK);
      for (let j = 0; j < Math.min(idx, VIEWS); j++) { const [x, y] = place(views[j]); diamond(x, y, settled); }
      if (training) {
        const v = views[idx], [tx, ty] = place(v), k = ease(clamp((q - 0.25) / 0.5));
        const sx = x0 + (v.S.reduce((a, i) => a + i, 0) / v.S.length) * (cw + gap) + cw / 2, sy = y0 + ch + 6;
        if (q > 0.25) diamond(lerp(sx, tx, k), lerp(sy, ty, k), clamp((q - 0.25) / 0.15));
      }
      if (!training) cleanLatent(ctx, cx, cy);
    });
  })();

  // ── 3. FuseLift: pipeline + what the affine step does to noise, effort and error ──
  (() => {
    const fig = $('#viz-lift'); if (!fig) return;
    const P = new Tween({ k: 0 });
    const pipe = $('.pipe', fig), badge = $('.dit-badge', fig);
    let mode = 'z';
    const placeBadge = () => {
      const n = $(`.tap[data-tap="${mode}"]`, pipe);
      badge.style.transform = `translate(${n.offsetLeft + n.offsetWidth / 2 - badge.offsetWidth / 2}px, ${n.offsetTop + n.offsetHeight + 12}px)`;
      $$('.tap', pipe).forEach(t => t.classList.toggle('active', t === n));
    };
    const text = {
      z: 'In encoder space, every direction gets the same noise and the same weight.',
      h0: 'One linear layer in, the directions the decoder reads are stretched above the noise.',
    };
    segmented(fig, 'mode', m => { mode = m; P.set({ k: m === 'h0' ? 1 : 0 }, 1100); placeBadge(); setStatus(fig, text[m]); }, 5200);
    new ResizeObserver(placeBadge).observe(pipe);
    addEventListener('load', placeBadge);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeBadge);
    placeBadge();
    requestAnimationFrame(() => requestAnimationFrame(() => { placeBadge(); badge.classList.add('ready'); }));

    const rot = (x, y) => [x * Math.cos(TILT) - y * Math.sin(TILT), x * Math.sin(TILT) + y * Math.cos(TILT)];
    mountCanvas($('canvas', fig), w => (w < 640 ? 3 * 232 : 270), (ctx, w, h, time) => {
      const k = P.get().k, wide = w >= 640;
      const pw = wide ? w / 3 : w, ph = wide ? h : h / 3;
      const titles = ['Add noise', 'DiT effort', 'DiT error'];
      for (let i = 0; i < 3; i++) {
        const px = wide ? i * pw : 0, py = wide ? 0 : i * ph, cx = px + pw / 2, cy = py + 34 + (ph - 34) / 2;
        ctx.font = `600 19px ${SANS}`; ctx.fillStyle = T.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(titles[i], cx, py + 4);

        if (i === 0) {
          const R = Math.min(pw, ph - 34) * 0.27;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.35);
          g.addColorStop(0, T.gray); g.addColorStop(0.75, T.gray); g.addColorStop(1, 'transparent');
          ctx.globalAlpha = 0.34; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
          // grain, so it reads as noise rather than a disc
          const r = rng(3 + Math.floor(time * 8));
          ctx.fillStyle = T.dot; ctx.globalAlpha = 0.28;
          for (let j = 0; j < 90; j++) { const a = r() * 7, d = Math.sqrt(r()) * R * 1.2; ctx.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2, 2); }
          ctx.globalAlpha = 1;
          const [ux, uy] = rot(1, 0), [vx, vy] = rot(0, -1);
          const lu = lerp(0.62, 0.36, k) * R, lv = lerp(0.62, 1.75, k) * R;
          arrow(ctx, cx, cy, cx + ux * lu, cy + uy * lu, T.teal, 3.6);
          arrow(ctx, cx, cy, cx + vx * lv, cy + vy * lv, T.purple, 3.6);
          cleanLatent(ctx, cx, cy);
        } else if (i === 1) {
          const Hm = (ph - 34) * 0.62, base = cy + Hm / 2 - 6, bw = 50, gap = 26;
          const hv = lerp(0.3, 1, k) * Hm, hu = lerp(0.3, 0.085, k) * Hm;
          ctx.fillStyle = T.purple; ctx.beginPath(); ctx.roundRect(cx - gap / 2 - bw, base - hv, bw, hv, [4, 4, 0, 0]); ctx.fill();
          ctx.fillStyle = T.teal; ctx.beginPath(); ctx.roundRect(cx + gap / 2, base - hu, bw, hu, [4, 4, 0, 0]); ctx.fill();
          ctx.strokeStyle = T.gray; ctx.lineWidth = 1.5; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(cx - bw - gap, base + 0.75); ctx.lineTo(cx + bw + gap, base + 0.75); ctx.stroke();
          ctx.font = `400 17px ${SANS}`; ctx.fillStyle = T.muted; ctx.textBaseline = 'top';
          ctx.globalAlpha = 1 - clamp(k * 2); ctx.fillText('equal', cx, base + 10);
          ctx.globalAlpha = clamp(k * 2 - 1); ctx.fillText('scaled by gain²', cx, base + 10);
          ctx.globalAlpha = 1;
        } else {
          const s = Math.min(pw / 4.0, (ph - 34) / 2.6);
          const p = {}; for (const key in BASE) p[key] = lerp(BASE[key], LIFT[key], k);
          drawInterface(ctx, cx, cy, s, p, time);
        }
        if (wide && i < 2) arrow(ctx, px + pw - 16, cy, px + pw + 16, cy, T.gray, 2.4);
      }
    });
  })();

  // ════════════════════════════════════════════════════════════════════
  //  Puzzle tiles
  // ════════════════════════════════════════════════════════════════════
  (() => {
    const fig = $('#viz-puzzle'); if (!fig) return;
    const strip = $('.layerstrip', fig);
    for (let i = 0; i < 23; i++) {
      const c = k => Math.round(lerp(k[0], k[1], i / 22));
      strip.insertAdjacentHTML('beforeend', `<i style="--i:${i};--c:rgb(${c([196, 78])},${c([203, 92])},${c([213, 112])})"></i>`);
    }
    const data = {
      7: { psnr: 22.58, ung: 1.65, gui: 1.08, notes: { psnr: ['higher is better', ''], ung: ['lower is better', ''], gui: ['lower is better', ''] } },
      23: { psnr: 27.04, ung: 3.01, gui: 1.25, notes: { psnr: ['4.5 dB sharper', 'better'], ung: ['82% worse', 'worse'], gui: ['16% worse', 'worse'] } },
    };
    const cur = { psnr: 22.58, ung: 1.65, gui: 1.08 };
    let raf = 0;
    segmented(fig, 'k', k => {
      const d = data[k], from = { ...cur }, t0 = performance.now(), dur = reduce ? 0 : 900;
      $$('i', strip).forEach((el, i) => el.classList.toggle('on', k === '23' || (i >= 10 && i % 2 === 0)));   // k=7 fuses layers 11, 13, ..., 23
      for (const key of ['psnr', 'ung', 'gui']) {
        const n = $(`[data-note="${key}"]`, fig);
        n.textContent = d.notes[key][0]; n.className = 'tile-note ' + d.notes[key][1];
      }
      cancelAnimationFrame(raf);
      const step = () => {
        const q = dur ? ease(clamp((performance.now() - t0) / dur)) : 1;
        for (const key of ['psnr', 'ung', 'gui']) { cur[key] = lerp(from[key], d[key], q); $(`[data-stat="${key}"]`, fig).textContent = cur[key].toFixed(2); }
        if (q < 1) raf = requestAnimationFrame(step);
      };
      step();
    }, 3800)(0);
  })();

  // ════════════════════════════════════════════════════════════════════
  //  Line charts (SVG): legend, selective direct labels, crosshair tooltip
  // ════════════════════════════════════════════════════════════════════
  let uid = 0;
  function lineChart(el, cfg) {
    el.innerHTML = '<div class="legend"></div><div class="plot"></div><div class="tip" hidden></div>';
    const [legend, plot, tip] = el.children;
    if (cfg.series.length > 1) legend.innerHTML = cfg.series.map(s => `<span><i style="--c:var(${s.color})"></i>${s.name}</span>`).join('');
    else legend.remove();
    const id = 'clip' + (uid++), M = { l: 50, r: 62, t: 30, b: 38 };
    let from = cfg.sets[cfg.initial], to = from, t0 = 0, dur = 0;
    let prog = reduce ? 1 : 0, p0 = 0, hover = -1, raf = 0, W = 0, H = 0;
    const fmt = v => v.toFixed(v < 1 ? 3 : 2);   // sub-1 gFID is reported to three decimals

    const now = () => {
      const k = dur ? ease(clamp((performance.now() - t0) / dur)) : 1;
      return { k, ymin: lerp(from.ymin, to.ymin, k), ymax: lerp(from.ymax, to.ymax, k), ticks: to.ticks,
        values: to.values.map((vs, i) => vs.map((v, j) => lerp(from.values[i][j], v, k))) };
    };
    function render() {
      W = plot.clientWidth; if (!W) return;
      H = Math.round(clamp(W * 0.42, 240, 300));
      const s = now(), n = cfg.cats.length;
      const x = i => M.l + (W - M.l - M.r) * (i / (n - 1));
      const y = v => M.t + (H - M.t - M.b) * (1 - (v - s.ymin) / (s.ymax - s.ymin));
      const reveal = M.l - 12 + (W - M.l - M.r + 24) * prog;
      let g = `<defs><clipPath id="${id}"><rect x="0" y="0" width="${reveal}" height="${H}"/></clipPath></defs>`;
      const td = s.ticks.some(t => t % 1) ? 1 : 0;
      for (const t of s.ticks) g += `<line class="grid" x1="${M.l - 8}" x2="${W - M.r + 8}" y1="${y(t)}" y2="${y(t)}"/><text x="${M.l - 16}" y="${y(t) + 5.5}" text-anchor="end">${t.toFixed(td)}</text>`;
      cfg.cats.forEach((c, i) => { g += `<text class="xt" x="${x(i)}" y="${H - 8}" text-anchor="middle">${c}</text>`; });
      if (hover >= 0) g += `<line class="cross" x1="${x(hover)}" x2="${x(hover)}" y1="${M.t - 6}" y2="${H - M.b + 6}"/>`;
      s.values.forEach((vs, si) => {
        const c = `var(${cfg.series[si].color})`;
        g += `<path d="${vs.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join('')}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" clip-path="url(#${id})"/>`;
        vs.forEach((v, i) => {
          if (x(i) > reveal) return;
          g += `<circle cx="${x(i)}" cy="${y(v)}" r="${i === hover ? 7 : 5}" fill="${c}" stroke="var(--card)" stroke-width="2"/>`;
        });
      });
      if (prog >= 1) {
        // value at the end of each line; equal values share one label, close ones are nudged apart
        const ends = s.values.map((vs, si) => ({ y: y(vs[n - 1]), text: fmt(to.values[si][n - 1]) })).sort((a, b) => a.y - b.y);
        for (let i = 1; i < ends.length; i++) {
          const a = ends[i - 1], b = ends[i];
          if (b.y - a.y < 21) { if (a.text === b.text) { b.skip = true; b.y = a.y; } else { const mid = (a.y + b.y) / 2; a.y = mid - 10.5; b.y = mid + 10.5; } }
        }
        for (const l of ends) if (!l.skip) g += `<text class="val" x="${x(n - 1) + 13}" y="${l.y + 5.5}">${l.text}</text>`;
      }
      plot.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${cfg.aria}">${g}</svg>`;

      if (hover >= 0) {
        tip.hidden = false;
        tip.innerHTML = `<b>${cfg.tipCat ? cfg.tipCat(hover) : cfg.cats[hover]}</b>` + cfg.series.map((sr, si) =>
          `<div><span><i style="--c:var(${sr.color})"></i>${sr.name}</span><strong>${fmt(to.values[si][hover])}</strong></div>`).join('');
        const tw = tip.offsetWidth, left = x(hover) + 16 + tw > W ? x(hover) - 16 - tw : x(hover) + 16;
        tip.style.left = Math.max(0, left) + 'px';
        tip.style.top = (plot.offsetTop + M.t) + 'px';
      } else tip.hidden = true;
    }
    function run() {
      cancelAnimationFrame(raf);
      const step = () => {
        if (p0) prog = clamp((performance.now() - p0) / 1300);
        render();
        if ((p0 && prog < 1) || (dur && performance.now() - t0 < dur)) raf = requestAnimationFrame(step);
      };
      step();
    }
    plot.addEventListener('pointermove', e => {
      const rect = plot.getBoundingClientRect(), n = cfg.cats.length;
      const i = clamp(Math.round((e.clientX - rect.left - M.l) / (W - M.l - M.r) * (n - 1)), 0, n - 1);
      if (i !== hover) { hover = i; render(); }
    });
    plot.addEventListener('pointerleave', () => { hover = -1; render(); });
    new ResizeObserver(render).observe(plot);
    if (!reduce) {
      const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { io.disconnect(); p0 = performance.now(); run(); } }, { threshold: 0.35 });
      io.observe(el);
    }
    render();
    return {
      set(key) {
        const s = now(); from = { ymin: s.ymin, ymax: s.ymax, values: s.values }; to = cfg.sets[key];
        t0 = performance.now(); dur = reduce ? 0 : 800; run();
      },
    };
  }

  const EPOCHS = ['epoch 20', '40', '60', '80'], epochTip = i => 'Epoch ' + [20, 40, 60, 80][i];

  (() => {   // z vs h0 during training
    const fig = $('#viz-lift-curves'); if (!fig) return;
    const chart = lineChart($('[data-chart="lift"]', fig), {
      cats: EPOCHS, tipCat: epochTip, initial: 'k23',
      aria: 'Guided gFID across training epochs when diffusing on the encoder latent z versus FuseLift on h0',
      series: [{ name: 'Standard: diffuse on z', color: '--gray' }, { name: 'FuseLift: diffuse on h₀', color: '--blue' }],
      sets: {
        k23: { ymin: 0.9, ymax: 2.4, ticks: [1.0, 1.5, 2.0], values: [[2.20, 1.57, 1.31, 1.25], [2.10, 1.34, 1.08, 1.07]] },
        k7: { ymin: 0.9, ymax: 2.4, ticks: [1.0, 1.5, 2.0], values: [[2.34, 1.46, 1.11, 1.08], [2.11, 1.32, 1.02, 0.984]] },
      },
    });
    segmented(fig, 'set', k => chart.set(k));
  })();

  // ════════════════════════════════════════════════════════════════════
  //  Leaderboard: ranked bars that re-sort when the metric changes
  // ════════════════════════════════════════════════════════════════════
  (() => {
    const fig = $('#viz-board'); if (!fig) return;
    const board = $('.board', fig);
    const rows = [
      ['SiT-XL/2', 1400, 1.92, 7.48], ['SiT-XL/2 + REPA', 1400, 1.30, 5.44], ['LightningDiT', 800, 1.24, 4.58],
      ['DDT-XL', 800, 1.29, 5.75], ['REPA-E', 800, 1.12, 3.06], ['REG', 800, 1.45, 4.50], ['RAE-XL', 800, 1.14, 3.27],
      ['JiT-H/16', 600, 1.87, 7.68], ['BAR-L', 400, 0.998, 3.64], ['RAEv2', 80, 1.08, 2.19],
      ['FuseLift, 23 layers', 80, 1.07, 2.30, 1], ['FuseLift, 7 layers', 80, 0.984, 2.14, 1],
    ].map(([name, ep, gfid, fdr6, ours]) => ({ name, ep, gfid, fdr6, ours }));
    const max = { gfid: 1.92, fdr6: 7.68 };
    rows.forEach(r => {
      r.el = document.createElement('div');
      r.el.className = 'brow' + (r.ours ? ' ours' : ''); r.el.setAttribute('role', 'row');
      r.el.innerHTML = `<span class="name" role="cell">${r.name}</span><span class="ep" role="cell">${r.ep} epochs</span><span class="track" role="cell"><i class="bar"></i><span class="v"></span></span>`;
      board.appendChild(r.el);
    });
    let metric = 'gfid', shown = reduce;
    const layout = () => {
      const rh = matchMedia('(max-width: 760px)').matches ? 62 : 34;
      const order = [...rows].sort((a, b) => a[metric] - b[metric]);
      board.style.height = rows.length * rh + 'px';
      order.forEach((r, i) => {
        r.el.style.transform = `translateY(${i * rh}px)`;
        $('.bar', r.el).style.width = shown ? `calc((100% - 74px) * ${r[metric] / max[metric]})` : '0';
        const v = r[metric];
        $('.v', r.el).textContent = metric === 'gfid' && v < 1 ? v.toFixed(3) : v.toFixed(2);
        r.el.title = `${r.name}: ${r.ep} training epochs`;
      });
    };
    segmented(fig, 'metric', m => { metric = m; layout(); });
    addEventListener('resize', layout);
    layout();
    if (!reduce) {
      const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { io.disconnect(); shown = true; layout(); } }, { threshold: 0.2 });
      io.observe(board);
    }
  })();

  // ── headline tiles count up once ──
  $$('[data-count]').forEach(el => {
    const target = parseFloat(el.dataset.count), start = parseFloat(el.parentElement.querySelector('s').textContent);
    const dec = (el.dataset.count.split('.')[1] || '').length;
    if (reduce) return;
    el.textContent = start.toFixed(dec);
    const io = new IntersectionObserver(es => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = () => { const q = ease(clamp((performance.now() - t0) / 1400)); el.textContent = lerp(start, target, q).toFixed(dec); if (q < 1) requestAnimationFrame(step); };
      setTimeout(step, 250);
    }, { threshold: 0.6 });
    io.observe(el);
  });

  // ── copy buttons ──
  $$('.copy').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.nextElementSibling.innerText); b.textContent = 'Copied'; }
    catch { b.textContent = 'Select and copy'; }
    setTimeout(() => { b.textContent = 'Copy'; }, 1600);
  }));
})();
