/*
 * Built-in parody creatives for FakeAds. Every brand here is made up.
 * Each render(stage, api) draws a small looping scene in the style of a
 * familiar kind of mobile ad. See js/fakeads.js for the api.
 */
(function (root) {
  'use strict';
  const FA = root.FakeAds;
  if (!FA) return;

  // ------------------------------------------------------------ helpers --

  const IMPACT = '"Arial Black", Impact, "Helvetica Neue", system-ui, sans-serif';

  /** Chunky outlined ad text. */
  function shout(ctx, s, x, y, size, fill, opts) {
    opts = opts || {};
    ctx.save();
    ctx.font = `900 ${size}px ${IMPACT}`;
    ctx.textAlign = opts.align || 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (opts.rotate) { ctx.translate(x, y); ctx.rotate(opts.rotate); x = 0; y = 0; }
    ctx.lineWidth = Math.max(3, size * 0.16);
    ctx.strokeStyle = opts.stroke || '#000';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(s, x, y);
    ctx.restore();
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** A cartoon pointing hand (the "tap here!" hand every ad has). */
  function hand(ctx, x, y, s, press) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s * (press ? 0.9 : 1), s * (press ? 0.9 : 1));
    ctx.fillStyle = '#ffd9b3';
    ctx.strokeStyle = '#6b3b1a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(6, 0); ctx.lineTo(6, 18); ctx.lineTo(22, 18);
    ctx.quadraticCurveTo(30, 18, 30, 26); ctx.lineTo(28, 44); ctx.lineTo(4, 44); ctx.lineTo(-6, 28);
    ctx.lineTo(-2, 22); ctx.lineTo(0, 24); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  /** Canvas creatives keep headlines below the engine's badge/countdown row. */
  const TOP = 64;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const ease = (t) => { t = clamp01(t); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };

  /** Scoped styles for DOM-based creatives. */
  function style(stage, css) {
    const s = document.createElement('style');
    s.textContent = css;
    stage.appendChild(s);
  }

  // ------------------------------------------------ 1. gate runner ------

  FA.register({
    id: 'mob-math',
    brand: 'Mob Math: Gate Rush',
    tagline: 'Only 1% pick the right gate!',
    category: 'Action',
    rating: 4.4,
    installs: '100M+',
    icon: { bg: 'linear-gradient(135deg,#2ec5ff,#1060ff)', text: '×2' },
    theme: { bg: '#7fd3ff' },
    ctaJoke: 'Your army of 3 has been notified.',
    render(stage, api) {
      const { ctx, w, h } = api.canvas();
      const roadL = w * 0.14, roadR = w * 0.86, roadW = roadR - roadL;
      const crowdY = h * 0.78;
      const CYCLE = 9.5;
      // Two gate pairs; the "player" always picks the worse gate.
      const pairs = [
        { at: 2.2, left: '+5', right: '×3', pick: -1, apply: (n) => n + 5 },
        { at: 4.3, left: '×2', right: '−12', pick: 1, apply: (n) => Math.max(1, n - 12) },
      ];
      const dot = (x, y, r, fill) => {
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.arc(x, y - r * 1.6, r * 0.75, 0, 7); ctx.fill();
        rr(ctx, x - r, y - r, r * 2, r * 2.2, r * 0.8); ctx.fill();
      };
      const crowdAt = (n, cx, cy, fill) => {
        for (let i = 0; i < n; i++) {
          const a = i * 2.39996, r = 7.5 * Math.sqrt(i);
          dot(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6, 5, fill);
        }
      };
      api.loop((t) => {
        const tc = t % CYCLE;
        // Sky + road.
        ctx.fillStyle = '#7fd3ff'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#6cc04a'; ctx.fillRect(0, 0, roadL, h); ctx.fillRect(roadR, 0, w - roadR, h);
        ctx.fillStyle = '#c9c3b8'; ctx.fillRect(roadL, 0, roadW, h);
        ctx.fillStyle = '#fff';
        const off = (t * 220) % 60;
        for (let y = -60 + off; y < h; y += 60) ctx.fillRect(w / 2 - 3, y, 6, 30);

        // Crowd state from the timeline.
        let n = 10, side = 0;
        for (const p of pairs) {
          if (tc > p.at - 1.1) side = p.pick * ease((tc - (p.at - 1.1)) / 0.7);
          if (tc >= p.at) n = p.apply(n);
        }
        if (tc > pairs[1].at + 0.6) side = lerp(side, 0, ease((tc - pairs[1].at - 0.6) / 0.6));
        const fightStart = 6.2, fightEnd = 7.0;
        let enemy = 40;
        const enemyY = lerp(-60, crowdY - 70, clamp01((tc - 4.6) / (fightStart - 4.6)));
        if (tc > fightStart) {
          const k = clamp01((tc - fightStart) / (fightEnd - fightStart));
          enemy = 40 - Math.round(n * k);
          n = Math.round(n * (1 - k));
        }
        const cx = w / 2 + side * roadW * 0.25;

        // Gates.
        for (const p of pairs) {
          const gy = crowdY - (p.at - tc) * 240;
          if (gy < -50 || gy > h + 20 || tc > p.at + 0.15) continue;
          const half = roadW / 2 - 6;
          [[p.left, roadL + 3], [p.right, w / 2 + 3]].forEach(([label, x]) => {
            const good = label[0] === '+' || label[0] === '×';
            ctx.fillStyle = good ? 'rgba(40,170,255,.55)' : 'rgba(255,60,60,.55)';
            rr(ctx, x, gy - 26, half, 52, 8); ctx.fill();
            ctx.strokeStyle = good ? '#0a74d8' : '#c01818'; ctx.lineWidth = 3; ctx.stroke();
            shout(ctx, label, x + half / 2, gy, 28, '#fff');
          });
        }
        // Enemy horde.
        if (tc > 4.6 && enemy > 0) {
          crowdAt(Math.min(enemy, 40), w / 2, enemyY, '#e53935');
          shout(ctx, String(enemy), w / 2, enemyY - 62, 22, '#ffdddd');
        }
        // Our crowd.
        if (n > 0) {
          crowdAt(n, cx, crowdY, '#1e63ff');
          ctx.fillStyle = '#1e63ff';
          rr(ctx, cx - 22, crowdY - 70, 44, 26, 13); ctx.fill();
          shout(ctx, String(n), cx, crowdY - 57, 18, '#fff', { stroke: '#0b2a80' });
        }
        // Copy.
        shout(ctx, 'ONLY 1% PICK', w / 2, TOP + 20, 30, '#ffe600');
        shout(ctx, 'THE RIGHT GATE!', w / 2, TOP + 54, 30, '#ffe600');
        if (tc > fightEnd) {
          const s = 1 + 0.08 * Math.sin(t * 10);
          shout(ctx, 'FAIL', w / 2, h * 0.42, 86 * s, '#ff2d2d', { rotate: -0.12 });
          shout(ctx, 'Can YOU do better?', w / 2, h * 0.55, 26, '#fff');
        }
      });
    },
  });

  // ------------------------------------------------ 2. tower defense ----

  FA.register({
    id: 'kingdom-siege',
    brand: 'Kingdom Siege: Tower Rush',
    tagline: 'Defend the kingdom. Or don’t. We’re an ad.',
    category: 'Strategy',
    rating: 4.6,
    installs: '50M+',
    icon: { bg: 'linear-gradient(135deg,#7a4a1e,#d49b3a)', text: '♜' },
    theme: { bg: '#4a8f3a' },
    ctaJoke: 'The kingdom has fallen while you read this.',
    confirmshame: { title: 'Abandon your kingdom?', body: 'Your 20 loyal citizens are counting on you.', yes: 'DEFEND IT', no: 'Let them fend for themselves' },
    render(stage, api) {
      const { ctx, w, h } = api.canvas();
      const P = [[0.12, -0.05], [0.12, 0.3], [0.85, 0.3], [0.85, 0.52], [0.2, 0.52], [0.2, 0.74], [0.62, 0.74], [0.62, 0.9]]
        .map(([x, y]) => [x * w, y * h]);
      const segs = [];
      let total = 0;
      for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); segs.push(l); total += l; }
      const at = (d) => {
        for (let i = 0; i < segs.length; i++) {
          if (d <= segs[i]) { const k = d / segs[i]; return [lerp(P[i][0], P[i + 1][0], k), lerp(P[i][1], P[i + 1][1], k)]; }
          d -= segs[i];
        }
        return P[P.length - 1];
      };
      const towers = [[0.3, 0.2], [0.62, 0.41], [0.38, 0.63], [0.78, 0.66]].map(([x, y]) => ({ x: x * w, y: y * h, cd: Math.random() }));
      let enemies = [], shots = [], spawn = 0, lives = 20, wave = 99, flash = 0;
      api.loop((t, dt) => {
        spawn -= dt;
        if (spawn <= 0) { spawn = 0.55; enemies.push({ d: 0, hp: 4, max: 4, sp: api.rand(55, 80) }); }
        for (const e of enemies) e.d += e.sp * dt;
        enemies = enemies.filter((e) => {
          if (e.hp <= 0) return false;
          if (e.d >= total) { lives--; if (lives <= 0) { lives = 20; wave++; flash = 1.6; } return false; }
          return true;
        });
        for (const tw of towers) {
          tw.cd -= dt;
          if (tw.cd > 0) continue;
          const target = enemies.find((e) => { const [x, y] = at(e.d); return Math.hypot(x - tw.x, y - tw.y) < w * 0.32; });
          if (target) { shots.push({ x: tw.x, y: tw.y - 14, e: target }); tw.cd = 0.7; }
        }
        for (const s of shots) {
          const [x, y] = at(s.e.d);
          const dx = x - s.x, dy = y - s.y, d = Math.hypot(dx, dy);
          if (d < 8) { s.done = true; s.e.hp--; continue; }
          s.x += (dx / d) * 420 * dt; s.y += (dy / d) * 420 * dt;
        }
        shots = shots.filter((s) => !s.done);
        flash = Math.max(0, flash - dt);

        ctx.fillStyle = '#4a8f3a'; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#d8b878'; ctx.lineWidth = 30; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
        // Castle.
        const [cx, cy] = P[P.length - 1];
        ctx.fillStyle = '#9aa0a8'; ctx.fillRect(cx - 34, cy - 6, 68, 44);
        for (let i = 0; i < 4; i++) ctx.fillRect(cx - 34 + i * 20, cy - 16, 12, 12);
        ctx.fillStyle = '#5b3a1e'; ctx.fillRect(cx - 9, cy + 14, 18, 24);
        // Towers.
        for (const tw of towers) {
          ctx.fillStyle = '#7b6a58'; ctx.fillRect(tw.x - 13, tw.y - 18, 26, 30);
          ctx.fillStyle = '#c0392b';
          ctx.beginPath(); ctx.moveTo(tw.x - 17, tw.y - 18); ctx.lineTo(tw.x, tw.y - 38); ctx.lineTo(tw.x + 17, tw.y - 18); ctx.fill();
        }
        // Enemies.
        for (const e of enemies) {
          const [x, y] = at(e.d);
          ctx.fillStyle = '#6b2fb3'; ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.fillRect(x - 4, y - 3, 3, 3); ctx.fillRect(x + 1, y - 3, 3, 3);
          ctx.fillStyle = '#300'; ctx.fillRect(x - 11, y - 17, 22, 4);
          ctx.fillStyle = '#3ddc4a'; ctx.fillRect(x - 11, y - 17, 22 * (e.hp / e.max), 4);
        }
        ctx.fillStyle = '#ffec3d';
        for (const s of shots) { ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, 7); ctx.fill(); }
        // HUD and copy.
        shout(ctx, `WAVE ${wave}`, 16, TOP + 4, 18, '#fff', { align: 'left' });
        shout(ctx, `♥ ${lives}`, w - 16, TOP + 4, 18, '#ff5a6e', { align: 'right' });
        const bob = Math.sin(t * 6) * 4;
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.arc(w * 0.5, h * 0.63, 20, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        hand(ctx, w * 0.5 + 6, h * 0.63 + 8 + bob, 1, Math.sin(t * 6) > 0.6);
        shout(ctx, 'TAP TO BUILD!', w / 2, h * 0.94, 30, '#ffe600');
        if (flash > 0) shout(ctx, 'DEFEAT', w / 2, h * 0.45, 64, '#ff3b3b', { rotate: -0.1 });
      });
    },
  });

  // ------------------------------------------------ 3. match-3 ----------

  FA.register({
    id: 'gem-jumble',
    brand: 'Gem Jumble Saga',
    tagline: 'Swap. Match. Forget your own name.',
    category: 'Puzzle',
    rating: 4.7,
    installs: '500M+',
    icon: { bg: 'linear-gradient(135deg,#ff4fa1,#ffb300)', text: '◆' },
    theme: { bg: '#3a1466' },
    ctaJoke: 'You have 5 lives. Buy more for $0.99.',
    render(stage, api) {
      const { ctx, w, h } = api.canvas();
      const COLS = 7, ROWS = 8, COLORS = ['#ff3b5c', '#ffb300', '#35d05c', '#2f8cff', '#b44dff', '#ff7ad9'];
      const cell = Math.min((w * 0.92) / COLS, (h * 0.6) / ROWS);
      const ox = (w - cell * COLS) / 2, oy = Math.max(h * 0.22, TOP + 84);
      const rnd = () => Math.floor(Math.random() * COLORS.length);
      let g = [];
      const matches = () => {
        const hit = new Set();
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS - 2; c++) {
          const k = g[r][c].k; if (k === g[r][c + 1].k && k === g[r][c + 2].k) [0, 1, 2].forEach((d) => hit.add(r * COLS + c + d));
        }
        for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS - 2; r++) {
          const k = g[r][c].k; if (k === g[r + 1][c].k && k === g[r + 2][c].k) [0, 1, 2].forEach((d) => hit.add((r + d) * COLS + c));
        }
        return hit;
      };
      do { g = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ k: rnd(), dy: 0, s: 1 }))); } while (matches().size);
      const swap = (a, b) => { const t = g[a[0]][a[1]]; g[a[0]][a[1]] = g[b[0]][b[1]]; g[b[0]][b[1]] = t; };
      const findSwap = () => {
        const opts = [];
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          for (const [dr, dc] of [[0, 1], [1, 0]]) {
            const r2 = r + dr, c2 = c + dc;
            if (r2 >= ROWS || c2 >= COLS) continue;
            swap([r, c], [r2, c2]);
            if (matches().size) opts.push([[r, c], [r2, c2]]);
            swap([r, c], [r2, c2]);
          }
        }
        return opts.length ? api.pick(opts) : null;
      };
      const WORDS = ['Shiny!', 'Gemtastic!', 'Sparkling!', 'OUTRAGEOUS!', 'Jewel-icious!'];
      let phase = 'idle', pt = 0, mv = null, popping = new Set(), score = 0, combo = 0, word = null;
      const drawGem = (k, x, y, s) => {
        const R = cell * 0.38 * s;
        ctx.fillStyle = COLORS[k];
        ctx.beginPath();
        if (k === 0) ctx.arc(x, y, R, 0, 7);
        else if (k === 1) { ctx.moveTo(x, y - R); ctx.lineTo(x + R, y); ctx.lineTo(x, y + R); ctx.lineTo(x - R, y); }
        else if (k === 2) rr(ctx, x - R * 0.85, y - R * 0.85, R * 1.7, R * 1.7, R * 0.3);
        else if (k === 3) { for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R); } }
        else if (k === 4) { ctx.moveTo(x, y - R); ctx.lineTo(x + R, y + R * 0.8); ctx.lineTo(x - R, y + R * 0.8); }
        else { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? R * 0.5 : R; ctx.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); } }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.beginPath(); ctx.arc(x - R * 0.3, y - R * 0.35, R * 0.22, 0, 7); ctx.fill();
      };
      api.loop((t, dt) => {
        pt += dt;
        if (phase === 'idle' && pt > 0.45) { mv = findSwap(); pt = 0; combo = 0; if (mv) phase = 'swap'; }
        else if (phase === 'swap' && pt > 0.22) { swap(mv[0], mv[1]); popping = matches(); phase = 'pop'; pt = 0; }
        else if (phase === 'pop' && pt > 0.28) {
          score += popping.size * 60 * (combo + 1);
          combo++;
          if (combo >= 1) word = { s: WORDS[Math.min(combo - 1 + Math.floor(Math.random() * 2), WORDS.length - 1)], t: 0 };
          // Gravity: survivors drop, new gems fall in from above.
          // dy is how far (in rows) a gem is drawn above its slot; it eases to 0.
          for (let c = 0; c < COLS; c++) {
            const keep = [];
            for (let r = ROWS - 1; r >= 0; r--) if (!popping.has(r * COLS + c)) keep.push({ gem: g[r][c], from: r });
            const fresh = ROWS - keep.length;
            for (let r = ROWS - 1, i = 0; r >= 0; r--, i++) {
              if (i < keep.length) { const { gem, from } = keep[i]; gem.dy = from - r; g[r][c] = gem; }
              else g[r][c] = { k: rnd(), dy: -fresh, s: 1 };
            }
          }
          popping = new Set(); phase = 'fall'; pt = 0;
        } else if (phase === 'fall') {
          let moving = false;
          for (const row of g) for (const gem of row) if (gem.dy < 0) { gem.dy = Math.min(0, gem.dy + dt * 14); moving = true; }
          if (!moving) { popping = matches(); if (popping.size) { phase = 'pop'; pt = 0; } else { phase = 'idle'; pt = 0; } }
        }
        if (word) word.t += dt;

        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#3a1466'); bg.addColorStop(1, '#8a2be2');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(20,0,50,.55)';
        rr(ctx, ox - 8, oy - 8, cell * COLS + 16, cell * ROWS + 16, 14); ctx.fill();
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
          const gem = g[r][c];
          let x = ox + (c + 0.5) * cell, y = oy + (r + 0.5 + gem.dy) * cell, s = 1;
          if (phase === 'swap' && mv) {
            const k = ease(pt / 0.22);
            if (mv[0][0] === r && mv[0][1] === c) { x = lerp(x, ox + (mv[1][1] + 0.5) * cell, k); y = lerp(y, oy + (mv[1][0] + 0.5) * cell, k); }
            if (mv[1][0] === r && mv[1][1] === c) { x = lerp(x, ox + (mv[0][1] + 0.5) * cell, k); y = lerp(y, oy + (mv[0][0] + 0.5) * cell, k); }
          }
          if (phase === 'pop' && popping.has(r * COLS + c)) s = 1 + 0.4 * Math.sin(Math.min(1, pt / 0.28) * Math.PI) - Math.min(1, pt / 0.28);
          if (y < oy - cell * 0.4) continue;
          if (s > 0.02) drawGem(gem.k, x, y, s);
        }
        shout(ctx, 'LEVEL 1  vs  LEVEL 9999', w / 2, TOP + 12, 22, '#fff');
        shout(ctx, `SCORE ${score.toLocaleString()}`, w / 2, TOP + 46, 26, '#ffe14d');
        if (word && word.t < 1) {
          const s = 1 + 0.5 * (1 - Math.min(1, word.t * 3));
          ctx.globalAlpha = 1 - Math.max(0, word.t - 0.6) / 0.4;
          shout(ctx, word.s, w / 2, oy + cell * ROWS * 0.45, 44 * s, '#ffe14d', { stroke: '#5a0a8a', rotate: -0.08 });
          ctx.globalAlpha = 1;
        }
        shout(ctx, 'Only 2% reach level 50!', w / 2, oy + cell * ROWS + 40, 20, '#fff');
      });
    },
  });

  // ------------------------------------------------ 4. word wheel -------

  FA.register({
    id: 'letter-grotto',
    brand: 'Letter Grotto',
    tagline: 'Train your brain. Or at least distract it.',
    category: 'Word',
    rating: 4.8,
    installs: '10M+',
    icon: { bg: 'linear-gradient(135deg,#0f7a6c,#58d3a0)', text: 'Aa' },
    theme: { bg: '#123c46' },
    ctaJoke: 'The 6-letter word is still out there.',
    render(stage, api) {
      const { ctx, w, h } = api.canvas();
      const LETTERS = ['P', 'L', 'A', 'N', 'E', 'T'];
      const WORDS = ['LANE', 'PLAN', 'NEAT', 'PLANT', 'PANEL'];
      const cx = w / 2, cy = h * 0.7, R = Math.min(w, h) * 0.2;
      const pos = LETTERS.map((_, i) => { const a = -Math.PI / 2 + (i * Math.PI * 2) / LETTERS.length; return [cx + Math.cos(a) * R, cy + Math.sin(a) * R]; });
      const PER = 1.7, CYCLE = WORDS.length * PER + 2.8;
      const pathOf = (word) => { const used = new Set(); return Array.from(word, (ch) => { const i = LETTERS.findIndex((l, k) => l === ch && !used.has(k)); used.add(i); return i; }); };
      api.loop((t) => {
        const tc = t % CYCLE;
        const found = Math.min(WORDS.length, Math.floor(tc / PER));
        const cur = found < WORDS.length ? WORDS[found] : null;
        const k = (tc % PER) / (PER * 0.75);
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#0e2f3a'); bg.addColorStop(1, '#1f6e62');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
        // Slots.
        const rows = WORDS.concat(['??????']);
        const box = Math.min(30, (w - 60) / 7);
        rows.forEach((word, r) => {
          const y = TOP + 6 + r * (box + 6);
          const len = word.length, x0 = cx - (len * (box + 4)) / 2;
          for (let i = 0; i < len; i++) {
            const done = r < found;
            ctx.fillStyle = done ? '#ffd24d' : r === WORDS.length ? 'rgba(255,120,120,.3)' : 'rgba(255,255,255,.18)';
            rr(ctx, x0 + i * (box + 4), y, box, box, 5); ctx.fill();
            if (done) shout(ctx, word[i], x0 + i * (box + 4) + box / 2, y + box / 2 + 1, box * 0.6, '#5a3b00', { stroke: '#ffd24d' });
          }
        });
        // Wheel.
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.beginPath(); ctx.arc(cx, cy, R * 1.45, 0, 7); ctx.fill();
        if (cur && k <= 1) {
          const p = pathOf(cur), n = Math.min(p.length, Math.floor(k * p.length) + 1);
          ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath(); for (let i = 0; i < n; i++) (i ? ctx.lineTo : ctx.moveTo).apply(ctx, pos[p[i]]); ctx.stroke();
          shout(ctx, cur.slice(0, n), cx, cy - R * 1.9, 30, '#fff', { stroke: '#ff8a3d' });
          const [hx, hy] = pos[p[n - 1]];
          hand(ctx, hx + 4, hy + 6, 0.9, true);
        }
        LETTERS.forEach((l, i) => shout(ctx, l, pos[i][0], pos[i][1], R * 0.5, '#1d3b44', { stroke: '#fff' }));
        if (!cur) {
          shout(ctx, 'Only GENIUSES find', cx, cy - R * 2.05, 24, '#ffe14d');
          shout(ctx, 'the 6-letter word!', cx, cy - R * 2.05 + 28, 24, '#ffe14d');
        }
      });
    },
  });

  // ------------------------------------------------ 5. pull the pin -----

  FA.register({
    id: 'pinhead-rescue',
    brand: 'Pinhead Rescue: Save Him!',
    tagline: 'Pull the right pin. 99% don’t.',
    category: 'Puzzle',
    rating: 4.3,
    installs: '100M+',
    icon: { bg: 'linear-gradient(135deg,#ff9a1f,#ff3d00)', text: '📌' },
    theme: { bg: '#2b2340' },
    ctaJoke: 'He’s fine. He was never real.',
    render(stage, api) {
      const { ctx, w, h } = api.canvas();
      const X0 = w * 0.15, X1 = w * 0.85, Y0 = Math.max(h * 0.2, TOP + 70), Y1 = h * 0.86;
      const midX = (X0 + X1) / 2, pinY = Y0 + (Y1 - Y0) * 0.42;
      const CYCLE = 7.5;
      api.loop((t) => {
        const tc = t % CYCLE;
        ctx.fillStyle = '#2b2340'; ctx.fillRect(0, 0, w, h);
        // Tower walls.
        ctx.fillStyle = '#8b8fa3';
        ctx.fillRect(X0 - 12, Y0, 12, Y1 - Y0); ctx.fillRect(X1, Y0, 12, Y1 - Y0); ctx.fillRect(X0 - 12, Y1, X1 - X0 + 24, 12);
        ctx.fillRect(midX - 6, Y0, 12, pinY - Y0);
        // Pins: the left pin (holding lava over the hero) gets pulled.
        const pull = ease((tc - 1.6) / 0.6);
        const pinOut = pull * (X1 - X0) * 0.7;
        ctx.fillStyle = '#d9dde8';
        rr(ctx, X0 - 20 - pinOut, pinY - 5, midX - X0 + 14, 10, 5); ctx.fill();
        ctx.beginPath(); ctx.arc(X0 - 26 - pinOut, pinY, 11, 0, 7); ctx.fill();
        rr(ctx, midX - 4, pinY - 5, X1 - midX + 16, 10, 5); ctx.fill();
        ctx.beginPath(); ctx.arc(X1 + 20, pinY, 11, 0, 7); ctx.fill();
        // Gold on the right.
        ctx.fillStyle = '#ffd23f';
        for (let i = 0; i < 18; i++) { const gx = midX + 16 + (i % 6) * ((X1 - midX - 28) / 6), gy = pinY - 12 - Math.floor(i / 6) * 13; ctx.beginPath(); ctx.arc(gx, gy, 6, 0, 7); ctx.fill(); }
        // Lava: sits on the pin, then falls onto the hero.
        const fall = clamp01((tc - 2.1) / 0.55);
        const lavaTop = lerp(Y0 + 20, Y1 - 60, fall * fall);
        const lavaH = lerp(pinY - Y0 - 26, 60, fall);
        ctx.fillStyle = '#ff5a1f';
        ctx.beginPath();
        ctx.moveTo(X0, lavaTop + lavaH);
        for (let x = X0; x <= midX - 6; x += 8) ctx.lineTo(x, lavaTop + Math.sin(x * 0.2 + t * 6) * 3);
        ctx.lineTo(midX - 6, lavaTop + lavaH);
        ctx.fill();
        // Hero.
        const hx = X0 + (midX - X0) / 2, hy = Y1 - 22;
        const burnt = tc > 2.7;
        ctx.strokeStyle = burnt ? '#222' : '#ffe0c2'; ctx.fillStyle = burnt ? '#222' : '#ffe0c2'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        if (fall < 1) {
          ctx.beginPath(); ctx.arc(hx, hy - 44, 11, 0, 7); ctx.fill();
          ctx.beginPath(); ctx.moveTo(hx, hy - 32); ctx.lineTo(hx, hy - 8);
          const wave = Math.sin(t * 14) * 6;
          ctx.moveTo(hx, hy - 26); ctx.lineTo(hx - 14, hy - 40 + wave); ctx.moveTo(hx, hy - 26); ctx.lineTo(hx + 14, hy - 40 - wave);
          ctx.moveTo(hx, hy - 8); ctx.lineTo(hx - 8, hy + 8); ctx.moveTo(hx, hy - 8); ctx.lineTo(hx + 8, hy + 8);
          ctx.stroke();
        }
        if (burnt) {
          ctx.fillStyle = 'rgba(80,80,80,.6)';
          for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(hx + Math.sin(t * 2 + i) * 10, hy - 70 - ((t * 30 + i * 20) % 60), 8, 0, 7); ctx.fill(); }
        }
        // Speech bubble, hand, copy.
        if (tc < 1.6) {
          ctx.fillStyle = '#fff'; rr(ctx, hx - 44, hy - 92, 88, 30, 12); ctx.fill();
          shout(ctx, 'HELP ME!', hx, hy - 77, 16, '#e0204a', { stroke: '#fff' });
        }
        if (tc > 0.8 && tc < 2.4) hand(ctx, X0 - 30 - pinOut, pinY + 4, 1, tc > 1.5);
        shout(ctx, 'HELP HIM!', w / 2, TOP + 24, 40, '#fff');
        if (burnt) {
          shout(ctx, '99% FAIL', w / 2, h * 0.5, 64 + Math.sin(t * 9) * 4, '#ff2d2d', { rotate: -0.1 });
          if (tc > 3.6) shout(ctx, 'Can YOU save him?', w / 2, h * 0.6, 26, '#ffe600');
        }
      });
    },
  });

  // ------------------------------------------------ 6. keyword-stuffed sort game

  FA.register({
    id: 'water-sort-3d',
    brand: 'Water Sort Puzzle - Color Sort Liquid Tube Sort 3D Game Free',
    tagline: 'Can you sort it? 99% can’t!',
    category: 'Puzzle',
    rating: 4.5,
    installs: '1B+',
    icon: { bg: 'linear-gradient(135deg,#40c4ff,#e040fb)', text: '🧪' },
    theme: { bg: '#fdf1d6' },
    ctaJoke: 'You are already playing it. Sort of.',
    render(stage, api) {
      const { ctx, w, h } = api.canvas();
      const COL = ['#ff4057', '#2f80ff', '#34c759'];
      const tubes = [[0, 1, 0, 2], [1, 2, 1, 0], [2, 0, 2, 1], []];
      const tw = Math.min(56, w / 7), th = tw * 3.6, gap = (w - tw * 4) / 5, ty = h * 0.34;
      let tries = 46;
      api.loop((t) => {
        const tc = t % 1.6;
        if (tc < 0.02) tries++;
        ctx.fillStyle = '#fdf1d6'; ctx.fillRect(0, 0, w, h);
        tubes.forEach((tube, i) => {
          const lift = i === 0 && tc > 0.2 ? -26 : 0;
          const shake = i === 1 && tc > 0.7 && tc < 1.2 ? Math.sin(tc * 60) * 5 : 0;
          const x = gap + i * (tw + gap) + shake, y = ty + lift;
          ctx.save();
          rr(ctx, x, y, tw, th, tw / 2); ctx.clip();
          tube.forEach((c, k) => { ctx.fillStyle = COL[c]; ctx.fillRect(x, y + th - (k + 1) * (th / 4.3), tw, th / 4.3 + 1); });
          ctx.restore();
          ctx.strokeStyle = '#7a8aa0'; ctx.lineWidth = 3; rr(ctx, x, y, tw, th, tw / 2); ctx.stroke();
        });
        if (tc > 0.7 && tc < 1.3) {
          const x = gap + (tw + gap) + tw / 2, y = ty + th / 2;
          shout(ctx, '✗', x, y, 70, '#ff2d2d', { stroke: '#fff' });
          shout(ctx, 'WRONG!', w / 2, ty + th + 50, 34, '#ff2d2d');
        }
        shout(ctx, 'SORT THE COLORS!', w / 2, TOP + 20, 30, '#ff7a00', { stroke: '#fff' });
        shout(ctx, `Attempts: ${tries}`, w / 2, TOP + 56, 22, '#333', { stroke: '#fff' });
        shout(ctx, '99% FAIL', w / 2, h * 0.86, 44, '#ff2d2d', { stroke: '#fff', rotate: -0.06 });
      });
    },
  });

  // ------------------------------------------------ 7. prediction market

  FA.register({
    id: 'polymarkup',
    brand: 'Polymarkup',
    tagline: 'Bet on anything. Literally anything.',
    category: 'Finance',
    rating: 4.2,
    installs: '5M+',
    cta: 'TRADE',
    icon: { bg: '#1652f0', text: '◆' },
    theme: { bg: '#0d1117', fg: '#e6edf3' },
    ctaJoke: 'Your position: 100% on “this app isn’t real”. You win.',
    render(stage, api) {
      style(stage, `
        .pm{position:absolute;inset:0;padding:56px 14px 14px;display:flex;flex-direction:column;gap:10px;overflow:hidden;font-family:system-ui,sans-serif}
        .pm h2{margin:0;font:800 26px/1 system-ui,sans-serif;letter-spacing:-.02em}
        .pm h2 i{font-style:normal;color:#4c8dff}
        .pm .sub{margin:0 0 4px;color:#8b949e;font-size:14px}
        .pm .card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:12px;display:grid;grid-template-columns:1fr auto;gap:8px 10px;align-items:center}
        .pm .q{font:600 14px/1.3 system-ui,sans-serif;grid-column:1/-1}
        .pm .vol{color:#8b949e;font-size:11px}
        .pm .btns{display:flex;gap:6px}
        .pm .btns span{min-width:64px;text-align:center;padding:7px 8px;border-radius:8px;font:700 13px/1 system-ui,sans-serif;transition:background .3s}
        .pm .yes{background:rgba(46,160,67,.18);color:#3fb950}
        .pm .no{background:rgba(248,81,73,.15);color:#f85149}
        .pm .up{background:rgba(46,160,67,.5)!important;color:#fff!important}
        .pm .down{background:rgba(248,81,73,.5)!important;color:#fff!important}
        .pm canvas{width:100%;height:26px;grid-column:1/-1}
        .pm .fine{margin-top:auto;color:#6e7681;font-size:10px;text-align:center}`);
      const box = api.el('div', 'pm', `<h2><i>◆</i> polymarkup</h2><p class="sub">Bet on anything. Literally anything.</p>`);
      stage.appendChild(box);
      const markets = [
        { q: 'Will you close this ad the moment the X appears?', p: 94, vol: '$4.2M', drift: 0.6 },
        { q: 'Will the group chat plan actually happen?', p: 4, vol: '$880K' },
        { q: 'Will it rain in Toledo on Thursday?', p: 41, vol: '$12.1M' },
        { q: 'Will anyone finish level 200?', p: 17, vol: '$2.9M' },
        { q: 'Will the next ad be for a shopping app?', p: 63, vol: '$640K' },
      ];
      for (const m of markets) {
        m.hist = Array.from({ length: 30 }, () => m.p + api.rand(-3, 3));
        const card = api.el('div', 'card', `<div class="q">${m.q}</div><span class="vol">${m.vol} Vol.</span>
          <div class="btns"><span class="yes"></span><span class="no"></span></div><canvas></canvas>`);
        box.appendChild(card);
        m.yes = card.querySelector('.yes'); m.no = card.querySelector('.no'); m.cv = card.querySelector('canvas');
      }
      box.appendChild(api.el('p', 'fine', 'Not a real market. Not real money. Not financial advice. Barely an app.'));
      const draw = (m) => {
        m.yes.textContent = `Yes ${Math.round(m.p)}¢`;
        m.no.textContent = `No ${100 - Math.round(m.p)}¢`;
        const c = m.cv, r = c.getBoundingClientRect(), dpr = Math.min(2, root.devicePixelRatio || 1);
        c.width = r.width * dpr; c.height = r.height * dpr;
        const x = c.getContext('2d'); x.scale(dpr, dpr);
        const lo = Math.min(...m.hist) - 2, hi = Math.max(...m.hist) + 2;
        x.strokeStyle = m.hist[m.hist.length - 1] >= m.hist[0] ? '#3fb950' : '#f85149'; x.lineWidth = 1.6;
        x.beginPath();
        m.hist.forEach((v, i) => x[i ? 'lineTo' : 'moveTo']((i / (m.hist.length - 1)) * r.width, r.height - ((v - lo) / (hi - lo)) * r.height));
        x.stroke();
      };
      markets.forEach(draw);
      api.every(650, () => {
        const m = api.pick(markets);
        const before = m.p;
        m.p = Math.max(1, Math.min(99, m.p + api.rand(-4, 4) + (m.drift || 0)));
        m.hist.push(m.p); m.hist.shift();
        draw(m);
        const btn = m.p >= before ? m.yes : m.no;
        btn.classList.add(m.p >= before ? 'up' : 'down');
        api.after(350, () => btn.classList.remove('up', 'down'));
      });
    },
  });

  // ------------------------------------------------ 8. discount mega-mall

  FA.register({
    id: 'temoo',
    brand: 'Temoo',
    tagline: 'Shop like a thousandaire.',
    category: 'Shopping',
    rating: 4.6,
    installs: '500M+',
    cta: 'SHOP NOW',
    icon: { bg: '#ff6a00', text: 'T' },
    theme: { bg: '#fff4ea', fg: '#222' },
    ctaJoke: 'Your order will arrive in 6–40 business weeks.',
    confirmshame: { title: 'Wait! Leaving already?', body: 'Your 90% OFF coupon will expire forever (until tomorrow).', yes: 'KEEP MY COUPON', no: 'I enjoy paying full price', yesJoke: 'Coupon saved to a folder that doesn’t exist.' },
    render(stage, api) {
      style(stage, `
        .tm{position:absolute;inset:0;padding:52px 14px 12px;display:flex;flex-direction:column;align-items:center;gap:10px;font-family:system-ui,sans-serif;color:#222}
        .tm h2{margin:0;font:900 34px/1 "Arial Black",Impact,sans-serif;color:#ff6a00;letter-spacing:-.03em}
        .tm .tag{margin:-6px 0 0;font-weight:700;font-size:14px}
        .tm .timer{background:#e0201b;color:#fff;border-radius:6px;padding:5px 10px;font:800 13px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums}
        .tm .wheelwrap{position:relative;width:min(56vw,190px);aspect-ratio:1}
        .tm .wheel{width:100%;height:100%;border-radius:50%;border:6px solid #ffb300;box-shadow:0 6px 18px rgba(255,106,0,.35);
          background:conic-gradient(#ff6a00 0 45deg,#fff 0 90deg,#ff6a00 0 135deg,#fff 0 180deg,#ff6a00 0 225deg,#fff 0 270deg,#ff6a00 0 315deg,#fff 0 360deg);
          transition:transform 3.2s cubic-bezier(.12,.8,.18,1)}
        .tm .wheel{position:relative}
        .tm .wheel b{position:absolute;left:50%;top:50%;font:900 12px/1 system-ui,sans-serif;white-space:nowrap}
        .tm .ptr{position:absolute;top:-10px;left:50%;transform:translateX(-50%);border:12px solid transparent;border-top:20px solid #e0201b}
        .tm .won{font:900 22px/1.1 "Arial Black",Impact,sans-serif;color:#e0201b;text-align:center;min-height:26px}
        .tm .won small{display:block;font:600 10px/1.2 system-ui,sans-serif;color:#888}
        .tm .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%}
        .tm .item{background:#fff;border-radius:10px;padding:8px 6px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.08)}
        .tm .item .pic{font-size:30px;line-height:1.2}
        .tm .item .n{font-size:10.5px;line-height:1.2;color:#444;min-height:26px}
        .tm .item .p{font:900 15px/1 system-ui,sans-serif;color:#e0201b}
        .tm .item s{color:#aaa;font-size:10px}
        .tm .item .sold{font-size:9.5px;color:#ff6a00;font-weight:700}
        .tm .ship{font-size:11px;color:#1a8f3c;font-weight:700}`);
      const items = [
        ['🎧', 'Wireless earbuds (wire included)', '0.97', '49.99'], ['👛', 'Almost-leather wallet', '1.12', '89.00'],
        ['🚁', 'Drone (flies sometimes)', '3.40', '399.00'], ['🔌', 'USB-C to USB-C to USB-C', '0.09', '19.99'],
        ['🐈', 'Cat-shaped cat', '0.50', '250.00'], ['⌚', 'Smart-ish watch', '2.20', '299.00'],
      ];
      const box = api.el('div', 'tm', `<h2>temoo</h2><p class="tag">Shop like a thousandaire</p>
        <div class="timer">Offer ends in <span class="cd">00:04:59</span></div>
        <div class="wheelwrap"><div class="ptr"></div><div class="wheel"></div></div>
        <div class="won"></div>
        <div class="grid">${items.map(([pic, n, p, was]) => `<div class="item"><div class="pic">${pic}</div><div class="n">${n}</div>
          <div class="p">$${p}</div><s>$${was}</s><div class="sold">${Math.floor(api.rand(2, 99))}K+ sold</div></div>`).join('')}</div>
        <div class="ship">FREE shipping · arrives in 6–40 business weeks</div>`);
      stage.appendChild(box);
      const wheel = box.querySelector('.wheel');
      const radius = wheel.getBoundingClientRect().width * 0.32;
      ['90%', '5%', 'FREE?', '80%', '1¢', '90%', '70%', '99%'].forEach((label, i) => {
        const b = api.el('b', null, label);
        // Centre of segment i, measured clockwise from the top like the conic gradient.
        b.style.transform = `translate(-50%,-50%) rotate(${i * 45 + 22.5}deg) translateY(${-radius}px)`;
        b.style.color = i % 2 ? '#ff6a00' : '#fff';
        wheel.appendChild(b);
      });
      let spins = 0;
      const spin = () => {
        spins++;
        wheel.style.transform = `rotate(${spins * 1440 + 22.5}deg)`;
        api.after(api.reduced ? 10 : 3300, () => { box.querySelector('.won').innerHTML = 'YOU WON 90% OFF!*<small>*on items already 90% off</small>'; });
      };
      api.after(300, spin);
      let secs = 299;
      const cd = box.querySelector('.cd');
      api.every(1000, () => {
        secs = secs > 0 ? secs - 1 : 299;
        cd.textContent = `00:0${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      });
    },
  });

  // ------------------------------------------------ 9. fast fashion -----

  FA.register({
    id: 'sheep',
    brand: 'SHEEP',
    tagline: 'Fast fashion. Faster sheep.',
    category: 'Shopping',
    rating: 4.7,
    installs: '100M+',
    cta: 'GET',
    icon: { bg: '#111', text: 'S' },
    theme: { bg: '#fff', fg: '#111' },
    ctaJoke: '37,000 new styles were added while you tapped that.',
    render(stage, api) {
      style(stage, `
        .sh{position:absolute;inset:0;display:flex;flex-direction:column;font-family:system-ui,sans-serif;color:#111}
        .sh header{padding:52px 14px 8px;text-align:center;border-bottom:1px solid #eee;background:#fff;position:relative;z-index:1}
        .sh h2{margin:0;font:900 30px/1 Didot,"Bodoni 72",Georgia,serif;letter-spacing:.28em}
        .sh .promo{margin-top:8px;background:#111;color:#fff;font:800 12px/1 system-ui,sans-serif;padding:7px;letter-spacing:.06em}
        .sh .promo b{color:#ff4d8d}
        .sh .feed{flex:1;overflow:hidden;position:relative}
        .sh .track{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px;animation:sh-scroll 14s linear infinite}
        @keyframes sh-scroll{to{transform:translateY(-50%)}}
        .sh .c{border-radius:4px;overflow:hidden;background:#fafafa}
        .sh .img{aspect-ratio:3/4;display:grid;place-items:center;font-size:54px}
        .sh .meta{padding:6px 8px 8px;font-size:11px}
        .sh .price{font:800 15px/1 system-ui,sans-serif;color:#e8175d}
        .sh .hot{color:#ff6a00;font-weight:700}`);
      const looks = [
        ['👗', '#ffd6e7', 'Dress (one size fits one)', '3.99'], ['🧥', '#e0ecff', 'Coat, emotionally warm', '7.49'],
        ['👖', '#dfe8f0', 'Jeans, pre-ripped, pre-regretted', '4.20'], ['👟', '#f3f3f3', 'Sneakers, left & right sold separately', '5.99'],
        ['🧢', '#fff1cc', 'Cap that says CAP', '1.49'], ['👚', '#e9ffe9', 'Top, 3% fabric', '2.99'],
        ['🕶️', '#eee', 'Sunglasses (dark mode)', '0.89'], ['👜', '#ffe5d6', 'Bag for your other bags', '6.66'],
      ];
      const card = ([pic, bg, name, price]) => `<div class="c"><div class="img" style="background:${bg}">${pic}</div>
        <div class="meta"><div class="price">$${price}</div>${name}<div class="hot">🔥 ${Math.floor(api.rand(3, 60))}k sold · Only ${Math.floor(api.rand(1, 4))} left!</div></div></div>`;
      const list = looks.map(card).join('');
      stage.appendChild(api.el('div', 'sh', `<header><h2>SHEEP</h2><div class="promo">EXTRA <b>70% OFF</b> · TODAY ONLY (EVERY DAY)</div></header>
        <div class="feed"><div class="track">${list}${list}</div></div>`));
    },
  });

  // ------------------------------------------------ 10. gacha RPG -------

  FA.register({
    id: 'loot-legends',
    brand: 'Loot Legends: Shadowfall',
    tagline: 'Level 1 to 100 in 3 days. Guaranteed-ish.',
    category: 'RPG',
    rating: 4.5,
    installs: '100M+',
    cta: 'PLAY FREE',
    icon: { bg: 'linear-gradient(135deg,#2b0a3d,#b8860b)', text: '⚔' },
    theme: { bg: '#12051d', fg: '#fff' },
    ctaJoke: '1,000,000 FREE gems added. (Value: $0.00)',
    confirmshame: { title: 'WAIT! Claim 500 FREE gems?', body: 'A gift from the Shadow Council. It expires in 00:00:03.', yes: 'CLAIM NOW', no: 'No thanks, I don’t like free things', yesJoke: 'Gems claimed. They are imaginary. Enjoy!' },
    render(stage, api) {
      style(stage, `
        .ll{position:absolute;inset:0;padding:56px 16px 16px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;
          background:radial-gradient(80% 60% at 50% 35%,#5b1f86,#12051d 70%);font-family:system-ui,sans-serif;color:#fff}
        .ll .lv{font:900 26px/1.05 "Arial Black",Impact,sans-serif;color:#ffd54a;text-shadow:0 3px 0 #7a4b00,0 0 20px rgba(255,200,60,.5)}
        .ll .hero{font-size:96px;line-height:1;filter:drop-shadow(0 0 22px rgba(190,120,255,.9));animation:ll-float 2.2s ease-in-out infinite}
        @keyframes ll-float{50%{transform:translateY(-10px)}}
        .ll .power{font:900 15px/1 system-ui,sans-serif;letter-spacing:.12em;color:#c9a8ff}
        .ll .num{font:900 40px/1 "Arial Black",Impact,sans-serif;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 0 16px #b06bff}
        .ll .cards{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
        .ll .card{width:56px;height:80px;border-radius:8px;display:grid;place-items:center;font:900 9px/1.1 system-ui,sans-serif;
          background:linear-gradient(160deg,#3a1a55,#1b0b29);border:2px solid #6c4aa0;transition:transform .35s;transform:rotateY(0)}
        .ll .card.flip{background:linear-gradient(160deg,#ffe27a,#c98a00);border-color:#fff3b0;color:#4a2c00;transform:rotateY(360deg);box-shadow:0 0 16px #ffd54a}
        .ll .free{font:900 17px/1.2 "Arial Black",Impact,sans-serif;color:#7dff8a}`);
      const box = api.el('div', 'll', `<div class="lv">LV 1 → LV 100<br>IN 3 DAYS!</div><div class="hero">🗡️</div>
        <div class="power">POWER</div><div class="num">1,203</div>
        <div class="cards">${'<div class="card">?</div>'.repeat(5)}</div>
        <div class="free">DOWNLOAD NOW &amp; GET<br>1,000,000 FREE GEMS</div>`);
      stage.appendChild(box);
      const num = box.querySelector('.num');
      let power = 1203;
      api.loop((t, dt) => {
        power = Math.min(9999999, power * (1 + dt * 1.6) + dt * 900);
        num.textContent = Math.floor(power).toLocaleString('en-US');
        if (power >= 9999999) power = 1203;
      });
      const cards = Array.from(box.querySelectorAll('.card'));
      let i = 0;
      // Every summon is legendary. Every single one.
      api.every(500, () => {
        const k = i++ % (cards.length + 2);
        if (k >= cards.length) cards.forEach((c) => { c.classList.remove('flip'); c.textContent = '?'; });
        else { cards[k].classList.add('flip'); cards[k].textContent = 'LEGENDARY'; }
      });
    },
  });
})(typeof self !== 'undefined' ? self : this);
