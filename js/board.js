/*
 * Board: lays out and draws tubes on a canvas, and runs every animation.
 *
 * The logical game state lives in the controller and changes instantly.
 * The board keeps its own visual copy of each tube and catches up through a
 * queue of animations, so the player can chain moves without waiting.
 * Moves that touch a tube still in motion wait for it; everything else runs
 * in parallel.
 */
(function (root) {
  'use strict';

  const PALETTE = [
    '#F0434F', // 0 red
    '#FF8B2B', // 1 orange
    '#FFD23F', // 2 yellow
    '#9FE03A', // 3 lime
    '#1FAE5E', // 4 green
    '#1ECBB8', // 5 teal
    '#52C6FF', // 6 sky
    '#3B63EE', // 7 blue
    '#9055F4', // 8 violet
    '#FF74B8', // 9 pink
    '#A3163A', // 10 wine
    '#9C6236', // 11 brown
    '#ECEFF6', // 12 white
    '#8494B6', // 13 slate
  ];
  const COLOR_NAMES = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'sky', 'blue', 'violet', 'pink', 'wine', 'brown', 'white', 'slate'];

  // ------------------------------------------------------------- helpers --

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(hex, target, amt) {
    const a = rgb(hex), b = target === 'white' ? [255, 255, 255] : [8, 10, 30];
    return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], amt))).join(',')})`;
  }
  function rgba(hex, al) { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${al})`; }
  function luminance(hex) { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }

  // ------------------------------------------------------------ geometry --

  /** Tube interior outline in local coords: origin top-left, y down, round bottom. */
  function tubePoly(w, H) {
    const r = w / 2, pts = [[0, 0], [0, H - r]];
    const segs = 14;
    for (let i = 1; i < segs; i++) {
      const phi = Math.PI - (Math.PI * i) / segs;
      pts.push([r + r * Math.cos(phi), H - r + r * Math.sin(phi)]);
    }
    pts.push([w, H - r], [w, 0]);
    return pts;
  }

  /** Area of polygon below the horizontal line y = Y (y grows downward). */
  function areaBelow(pts, Y) {
    const n = pts.length;
    let area = 0, fx = 0, fy = 0, px = 0, py = 0, first = true;
    const add = (x, y) => {
      if (first) { fx = x; fy = y; first = false; } else area += px * y - x * py;
      px = x; py = y;
    };
    for (let i = 0; i < n; i++) {
      const P = pts[i], Q = pts[(i + 1) % n];
      const pin = P[1] >= Y, qin = Q[1] >= Y;
      if (pin) add(P[0], P[1]);
      if (pin !== qin) { const t = (Y - P[1]) / (Q[1] - P[1]); add(P[0] + t * (Q[0] - P[0]), Y); }
    }
    if (first) return 0;
    area += px * fy - fx * py;
    return Math.abs(area) / 2;
  }

  class Geo {
    constructor(w, cap) {
      this.w = w;
      this.cap = cap;
      this.u = w * (cap >= 5 ? 0.84 : 0.92);
      this.neck = this.u * 0.6;
      this.H = cap * this.u + this.neck;
      this.wall = Math.max(1.6, w * 0.075);
      this.poly = tubePoly(w, this.H);
      // Tilt angle at which a given liquid area sits exactly at the lip.
      this.thetaTable = [];
      for (let d = 0; d <= 90; d += 0.5) {
        const th = (d * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
        const rot = this.poly.map(([x, y]) => { const dx = x - w; return [dx * c - y * s, dx * s + y * c]; });
        this.thetaTable.push([th, areaBelow(rot, 0)]);
      }
      this.unitArea = [];
      for (let k = 0; k <= cap * 20; k++) this.unitArea.push(areaBelow(this.poly, this.H - (k / 20) * this.u));
    }
    /** Liquid area for a volume in units (upright tube). */
    area(v) {
      const x = clamp(v, 0, this.cap) * 20, i = Math.floor(x), f = x - i;
      if (i >= this.unitArea.length - 1) return this.unitArea[this.unitArea.length - 1];
      return lerp(this.unitArea[i], this.unitArea[i + 1], f);
    }
    /** Tilt (radians) at which `v` units reach the lip. */
    theta(v) {
      const A = this.area(v), T = this.thetaTable;
      for (let i = 1; i < T.length; i++) {
        if (T[i][1] <= A) {
          const [t0, a0] = T[i - 1], [t1, a1] = T[i];
          return lerp(t0, t1, (a0 - A) / Math.max(1e-6, a0 - a1));
        }
      }
      return T[T.length - 1][0];
    }
  }

  // ---------------------------------------------------------------- tube --

  function layersFrom(arr) {
    const out = [];
    for (const c of arr) {
      if (out.length && out[out.length - 1].c === c) out[out.length - 1].v += 1;
      else out.push({ c, v: 1 });
    }
    return out;
  }
  const volume = (layers) => layers.reduce((s, l) => s + l.v, 0);

  /** base layers plus `extra` units of color c on top. */
  function withTop(base, c, extra) {
    const out = base.map((l) => ({ c: l.c, v: l.v }));
    if (extra <= 1e-4) return out;
    if (out.length && out[out.length - 1].c === c) out[out.length - 1].v += extra;
    else out.push({ c, v: extra });
    return out;
  }
  function withoutTop(layers, n) {
    const out = layers.map((l) => ({ c: l.c, v: l.v }));
    let left = n;
    while (left > 1e-4 && out.length) {
      const t = out[out.length - 1];
      const take = Math.min(t.v, left);
      t.v -= take; left -= take;
      if (t.v <= 1e-4) out.pop();
    }
    return out;
  }

  class Tube {
    constructor(i, contents) {
      this.i = i;
      this.layers = layersFrom(contents);
      this.home = { x: 0, y: 0 };
      this.pos = null; // drawn top-left, eases toward home
      this.lift = 0;
      this.liftTarget = 0;
      this.pose = null; // { cx, cy, a, kx } while flying
      this.lockSrc = null;
      this.lockDst = null;
      this.returning = null; // flying home after a pour: may receive, may not pour
      this.shakeT = 0;
      this.wob = 0;
      this.wobPhase = Math.random() * 6;
      this.cork = 0; // 0 none → 1 seated
      this.corked = false;
      this.glow = 0;
      this.glowColor = null;
      this.enter = 1;
      this.enterDelay = 0;
      this.fade = 1;
    }
    get busy() { return !!(this.lockSrc || this.lockDst); }
  }

  // --------------------------------------------------------------- board --

  class Board {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = Object.assign({ symbols: false, reducedMotion: false, speed: 1 }, opts || {});
      this.tubes = [];
      this.cap = 4;
      this.region = { x: 0, y: 0, w: 300, h: 300 };
      this.anims = [];
      this.queue = [];
      this.particles = [];
      this.streams = [];
      this.selected = -1;
      this.hintMove = null;
      this.hintT = 0;
      this.dpr = 1;
      this.running = false;
      this.last = 0;
      this.onEvent = () => {};
      this._loop = this._loop.bind(this);
    }

    // ---- setup

    setPuzzle(tubes, cap, animateIn) {
      this.cap = cap;
      this.tubes = tubes.map((t, i) => new Tube(i, t));
      this.anims = [];
      this.queue = [];
      this.streams = [];
      this.particles = this.particles.filter((p) => p.type === 'confetti');
      this.selected = -1;
      this.hintMove = null;
      this.layout(true);
      for (const t of this.tubes) {
        t.corked = t.cork = 0;
        if (this._isComplete(t)) { t.corked = true; t.cork = 1; }
        if (animateIn && !this.opts.reducedMotion) { t.enter = 0; t.enterDelay = 40 * t.i; }
      }
    }

    addTube() {
      const t = new Tube(this.tubes.length, []);
      this.tubes.push(t);
      this.layout(false);
      t.pos = { x: t.home.x, y: t.home.y };
      t.enter = 0;
      t.enterDelay = 60;
    }

    resize(width, height, region) {
      this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
      this.cssW = width; this.cssH = height;
      this.canvas.width = Math.round(width * this.dpr);
      this.canvas.height = Math.round(height * this.dpr);
      this.canvas.style.width = width + 'px';
      this.canvas.style.height = height + 'px';
      this.region = region;
      this.layout(true);
    }

    layout(snap) {
      const n = this.tubes.length, cap = this.cap;
      if (!n) return;
      const R = this.region;
      const uRatio = cap >= 5 ? 0.84 : 0.92;
      const tubeH = (cap + 0.6) * uRatio; // in units of w
      const options = [];
      for (let rows = 1; rows <= 4; rows++) {
        const perRow = Math.ceil(n / rows);
        if (rows > 1 && (Math.ceil(n / (rows - 1)) === perRow || perRow < 3)) continue;
        const wH = R.w / (perRow * 1.72);
        const rowUnits = tubeH + 0.7 + (rows > 1 ? 0.8 : 0.3);
        const wV = R.h / (rows * rowUnits);
        options.push({ rows, perRow, w: Math.min(wH, wV, 62) });
      }
      // Fewer rows read better; take them unless the tubes get much smaller.
      const maxW = Math.max(...options.map((o) => o.w));
      const best = options.find((o) => o.w >= maxW * 0.85 && o.w >= 36) || options.find((o) => o.w === maxW);
      const { rows } = best;
      const w = Math.floor(best.w);
      this.geo = new Geo(w, cap);
      const g = this.geo;
      const rowGap = rows > 1 ? 0.8 * w : 0;
      const liftSpace = 0.7 * w;
      const rowH = g.H + liftSpace;
      const totalH = rows * rowH + (rows - 1) * rowGap;
      const y0 = R.y + Math.max(0, (R.h - totalH) / 2) + liftSpace;
      const base = Math.floor(n / rows), extra = n % rows;
      let idx = 0;
      this.cell = { w: 0, h: rowH };
      for (let r = 0; r < rows; r++) {
        const count = base + (r < extra ? 1 : 0);
        const cw = Math.min(R.w / Math.max(count, best.perRow), w * 2.3);
        this.cell.w = cw;
        const x0 = R.x + (R.w - cw * count) / 2;
        for (let k = 0; k < count; k++, idx++) {
          const t = this.tubes[idx];
          t.home = { x: x0 + cw * (k + 0.5) - w / 2, y: y0 + r * (rowH + rowGap) };
          t.cellW = cw;
          t.row = r;
          if (snap || !t.pos) t.pos = { x: t.home.x, y: t.home.y };
        }
      }
      this.rowGap = rowGap;
    }

    // ---- input

    /** Tube under a point, with generous targets: the whole cell, then the nearest tube. */
    hitTest(x, y) {
      const g = this.geo;
      if (!g) return -1;
      let best = -1, bestD = Infinity;
      for (const t of this.tubes) {
        const cx = t.home.x + g.w / 2;
        const top = t.home.y - g.w * 0.8, bottom = t.home.y + g.H + Math.max(g.w * 0.3, this.rowGap * 0.5);
        const half = t.cellW / 2;
        if (x >= cx - half && x <= cx + half && y >= top && y <= bottom) return t.i;
        const dx = Math.max(0, Math.abs(x - cx) - half);
        const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; best = t.i; }
      }
      return bestD < g.w * 0.9 ? best : -1;
    }

    select(i) {
      this.selected = i;
      for (const t of this.tubes) t.liftTarget = t.i === i ? 1 : 0;
    }

    shake(i) {
      const t = this.tubes[i];
      if (t) t.shakeT = 1;
    }

    setHint(move) { this.hintMove = move; this.hintT = 0; }

    // ---- animations

    /** Queue a pour of n units of color c from a to b (already applied logically). */
    pour(a, b, c, n) {
      this.queue.push({ type: this.opts.reducedMotion ? 'transfer' : 'pour', a, b, c, n });
      this._pump();
    }

    /** In-place transfer, used for undo. Finishes everything in flight first. */
    undo(from, to, c, n) {
      this.finishAll();
      this.queue.push({ type: 'transfer', a: from, b: to, c, n, dur: 190 });
      this._pump();
    }

    /** Jump every running and queued animation to its end state. */
    finishAll() {
      for (const an of this.anims) this._end(an);
      this.anims = [];
      const q = this.queue; this.queue = [];
      for (const m of q) {
        const A = this.tubes[m.a], B = this.tubes[m.b];
        A.layers = withoutTop(A.layers, m.n);
        B.layers = withTop(B.layers, m.c, m.n);
        this._afterFill(B, true);
        this._afterFill(A, true);
      }
      this.streams = [];
      for (const t of this.tubes) { t.pose = null; t.lockSrc = t.lockDst = t.returning = null; }
    }

    /** Replace contents without animation (restart, resync). */
    sync(tubes) {
      this.finishAll();
      while (this.tubes.length > tubes.length) this.tubes.pop();
      tubes.forEach((arr, i) => {
        const t = this.tubes[i] || (this.tubes[i] = new Tube(i, []));
        t.layers = layersFrom(arr);
        t.corked = this._isComplete(t);
        t.cork = t.corked ? 1 : 0;
      });
      this.layout(false);
    }

    get idle() { return !this.anims.length && !this.queue.length; }

    _pump() {
      // Moves start in order; a move waits if an earlier waiting move shares a tube.
      const held = new Set();
      const rest = [];
      for (const m of this.queue) {
        const A = this.tubes[m.a], B = this.tubes[m.b];
        const blocked = held.has(m.a) || held.has(m.b) || A.busy || A.returning || B.busy;
        if (blocked) { held.add(m.a); held.add(m.b); rest.push(m); continue; }
        this._start(m);
      }
      this.queue = rest;
    }

    /** How far behind the player the board is: animations speed up to catch up. */
    get backlog() { return this.queue.length; }

    _start(m) {
      const A = this.tubes[m.a], B = this.tubes[m.b], g = this.geo;
      const speed = this.opts.speed;
      const an = {
        ...m, t: 0, speed,
        srcStart: A.layers.map((l) => ({ ...l })),
        srcBase: withoutTop(A.layers, m.n),
        dstBase: B.layers.map((l) => ({ ...l })),
      };
      A.lockSrc = an; B.lockDst = an;
      if (m.type === 'transfer') {
        an.dur = (m.dur || 230) / speed;
      } else {
        const dir = this._pourDir(A, B);
        const kx = dir > 0 ? g.w : 0;
        const V0 = volume(A.layers);
        const bx = B.home.x + g.w / 2;
        an.dir = dir;
        an.kx = kx;
        an.P = { x: bx - dir * g.w * 0.12, y: B.home.y - g.w * 1.15 };
        an.V0 = V0;
        an.th0 = Math.max(0.7, g.theta(V0));
        an.th1 = Math.min(1.53, Math.max(an.th0 + 0.05, g.theta(V0 - m.n)));
        const from = A.pos, lift = A.lift * g.w * 0.45;
        an.start = { cx: from.x + kx, cy: from.y - lift };
        an.fly = 250 / speed;
        an.pourDur = Math.min(620, 190 + 105 * m.n) / speed;
        an.lag = 80 / speed;
        an.back = 240 / speed;
        an.dur = an.fly + an.pourDur + an.lag + an.back;
        A.pose = { cx: an.start.cx, cy: an.start.cy, a: 0, kx };
        this.onEvent('pourStart', { a: m.a, b: m.b, n: m.n, c: m.c, delay: an.fly, dur: an.pourDur, fillFrom: volume(B.layers), cap: this.cap });
      }
      A.liftTarget = 0;
      if (this.selected === m.a) this.selected = -1;
      this.anims.push(an);
    }

    _pourDir(A, B) {
      const g = this.geo, bx = B.home.x + g.w / 2;
      let dir = A.home.x <= B.home.x ? 1 : -1;
      const reach = g.H * 0.8;
      if (dir > 0 && bx - reach < 0) dir = -1;
      else if (dir < 0 && bx + reach > this.cssW) dir = 1;
      return dir;
    }

    _step(an, dt) {
      an.t += dt;
      const A = this.tubes[an.a], B = this.tubes[an.b];
      if (an.type === 'transfer') {
        const p = easeInOut(clamp(an.t / an.dur, 0, 1));
        A.layers = withTop(an.srcBase, an.c, an.n * (1 - p));
        B.layers = withTop(an.dstBase, an.c, an.n * p);
        B.wob = Math.max(B.wob, 0.35 * (1 - p));
        if (an.t >= an.dur) { this._end(an); return false; }
        return true;
      }
      const g = this.geo;
      const t = an.t;
      const tp = t - an.fly; // time into pour
      // Source motion.
      if (t < an.fly) {
        const k = easeInOut(t / an.fly);
        const arc = Math.sin(Math.PI * k) * g.w * 0.5;
        A.pose = {
          cx: lerp(an.start.cx, an.P.x, k),
          cy: lerp(an.start.cy, an.P.y, k) - arc,
          a: an.dir * an.th0 * easeOut(k),
          kx: an.kx,
        };
      } else if (tp < an.pourDur + an.lag) {
        const p = clamp(tp / an.pourDur, 0, 1);
        const drained = an.n * p;
        A.layers = withTop(an.srcBase, an.c, an.n - drained);
        const th = Math.max(an.th0, Math.min(an.th1, g.theta(an.V0 - drained)));
        A.pose = { cx: an.P.x, cy: an.P.y, a: an.dir * th, kx: an.kx };
        // Stream.
        an.stream = an.stream || { c: an.c, x: an.P.x, y0: an.P.y, head: an.P.y, tail: an.P.y, dst: an.b };
        const surf = this._surfaceY(B);
        const fallV = (surf - an.P.y) / an.lag;
        an.stream.head = Math.min(surf, an.P.y + tp * fallV);
        an.stream.tail = tp > an.pourDur ? Math.min(surf, an.P.y + (tp - an.pourDur) * fallV) : an.P.y;
        an.stream.target = surf;
        // Destination fills after the stream lands.
        const q = clamp((tp - an.lag) / an.pourDur, 0, 1);
        B.layers = withTop(an.dstBase, an.c, an.n * q);
        if (q > 0 && q < 1) {
          B.wob = Math.max(B.wob, 0.9);
          if (Math.random() < dt / 45) this._splash(B, an.c, an.stream.x);
        }
      } else {
        if (an.stream) { an.stream = null; }
        if (!an.srcDone) {
          an.srcDone = true;
          A.layers = an.srcBase.map((l) => ({ ...l }));
          A.lockSrc = null;
          A.returning = an;
          this._needPump = true;
        }
        if (!an.dstDone) { an.dstDone = true; B.layers = withTop(an.dstBase, an.c, an.n); B.lockDst = null; this._afterFill(B); this._needPump = true; }
        const k = easeInOut(clamp((tp - an.pourDur - an.lag) / an.back, 0, 1));
        const endA = an.endA != null ? an.endA : (an.endA = A.pose.a);
        const hx = A.home.x + an.kx, hy = A.home.y - A.lift * g.w * 0.45;
        A.pose = {
          cx: lerp(an.P.x, hx, k),
          cy: lerp(an.P.y, hy, k) - Math.sin(Math.PI * k) * g.w * 0.3,
          a: lerp(endA, 0, easeOut(k)),
          kx: an.kx,
        };
        if (k >= 1) { this._end(an); return false; }
      }
      return true;
    }

    _end(an) {
      const A = this.tubes[an.a], B = this.tubes[an.b];
      if (!an.srcDone) { an.srcDone = true; A.layers = an.srcBase.map((l) => ({ ...l })); }
      if (A.returning === an) A.returning = null;
      if (!an.dstDone) {
        an.dstDone = true;
        B.layers = withTop(an.dstBase, an.c, an.n);
        if (B.lockDst === an) B.lockDst = null;
        this._afterFill(B);
      }
      if (A.lockSrc === an) A.lockSrc = null;
      if (an.type !== 'transfer' && A.pose) { A.pose = null; A.pos = { x: A.home.x, y: A.home.y }; }
      this._afterFill(A);
      if (this.selected === an.a) A.liftTarget = 1;
    }

    _afterFill(t, silent) {
      const done = this._isComplete(t);
      if (done && !t.corked) {
        t.corked = true;
        t.cork = silent || this.opts.reducedMotion ? 1 : 0.0001;
        if (!silent) {
          t.glow = 1;
          t.glowColor = PALETTE[t.layers[0].c];
          this._sparkle(t);
          this.onEvent('complete', { i: t.i, c: t.layers[0].c });
        }
      } else if (!done && t.corked) {
        t.corked = false;
        t.cork = 0;
      }
    }

    _isComplete(t) {
      return t.layers.length === 1 && Math.abs(t.layers[0].v - this.cap) < 1e-3;
    }

    _surfaceY(t) {
      const g = this.geo;
      return t.home.y + g.H - volume(t.layers) * g.u;
    }

    // ---- particles

    _splash(t, c, x) {
      const y = this._surfaceY(t);
      for (let k = 0; k < 2; k++) {
        this.particles.push({
          type: 'drop', x: x + (Math.random() - 0.5) * this.geo.w * 0.3, y,
          vx: (Math.random() - 0.5) * 0.12, vy: -0.12 - Math.random() * 0.12,
          life: 0, max: 280 + Math.random() * 120, color: PALETTE[c], size: this.geo.w * (0.05 + Math.random() * 0.04),
        });
      }
    }

    _sparkle(t) {
      const g = this.geo, cx = t.home.x + g.w / 2, cy = t.home.y + g.u * 0.2;
      for (let k = 0; k < 16; k++) {
        const ang = (Math.PI * 2 * k) / 16 + Math.random() * 0.3;
        const sp = 0.08 + Math.random() * 0.14;
        this.particles.push({
          type: 'spark', x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 0.08,
          life: 0, max: 500 + Math.random() * 300, color: k % 3 ? PALETTE[t.layers[0].c] : '#FFFFFF', size: g.w * 0.07,
        });
      }
    }

    confetti() {
      const colors = [...new Set(this.tubes.flatMap((t) => t.layers.map((l) => PALETTE[l.c])))];
      const W = this.cssW;
      for (let k = 0; k < 140; k++) {
        this.particles.push({
          type: 'confetti', x: Math.random() * W, y: -20 - Math.random() * this.cssH * 0.5,
          vx: (Math.random() - 0.5) * 0.08, vy: 0.12 + Math.random() * 0.18,
          rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.02, sway: Math.random() * 6,
          life: 0, max: 3200 + Math.random() * 1200, color: colors[k % colors.length] || '#FFD23F', size: 5 + Math.random() * 5,
        });
      }
    }

    // ---- loop

    start() {
      if (this.running) return;
      this.running = true;
      this.last = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this._loop);
    }
    stop() { this.running = false; cancelAnimationFrame(this.raf); }

    _loop(now) {
      if (!this.running) return;
      this.raf = requestAnimationFrame(this._loop); // re-arm first: one bad frame must not stop the game
      const dt = Math.max(0, Math.min(50, now - this.last));
      this.last = now;
      try {
        this.update(dt);
        this.draw(now);
      } catch (e) {
        this.lastError = e;
        console.error(e);
      }
    }

    update(dt) {
      const wasBusy = !this.idle;
      const rush = Math.min(4, 1 + 0.7 * this.backlog);
      this.anims = this.anims.filter((an) => this._step(an, dt * rush));
      if (this._needPump || this.queue.length) { this._needPump = false; this._pump(); }
      this.streams = this.anims.filter((a) => a.stream).map((a) => a.stream);
      const g = this.geo;
      const k = 1 - Math.exp(-dt / 55); // lift spring: ~110ms to settle
      const kp = 1 - Math.exp(-dt / 70);
      for (const t of this.tubes) {
        t.lift += (t.liftTarget - t.lift) * k;
        if (!t.pose && t.pos) {
          t.pos.x += (t.home.x - t.pos.x) * kp;
          t.pos.y += (t.home.y - t.pos.y) * kp;
        }
        if (t.shakeT > 0) t.shakeT = Math.max(0, t.shakeT - dt / 280);
        t.wob = Math.max(0, t.wob - dt / 380);
        t.wobPhase += dt / 60;
        if (t.cork > 0 && t.cork < 1) t.cork = Math.min(1, t.cork + dt / 380);
        if (t.glow > 0) t.glow = Math.max(0, t.glow - dt / 900);
        if (t.enter < 1) {
          if (t.enterDelay > 0) t.enterDelay -= dt;
          else t.enter = Math.min(1, t.enter + dt / 380);
        }
      }
      if (this.hintMove) this.hintT += dt;
      for (const p of this.particles) {
        p.life += dt;
        if (p.type === 'confetti') {
          p.x += p.vx * dt + Math.sin((p.life / 400) + p.sway) * 0.3;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
        } else {
          p.vy += 0.0009 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
        }
      }
      this.particles = this.particles.filter((p) => p.life < p.max);
      void g;
      if (wasBusy && this.idle) this.onEvent('idle');
    }

    // ---- drawing

    draw(now) {
      const ctx = this.ctx, dpr = this.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (!this.geo) return;
      const flying = [];
      for (const t of this.tubes) {
        if (t.pose) { flying.push(t); continue; }
        this._drawTube(t, now);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const s of this.streams) this._drawStream(s, now);
      for (const t of flying) this._drawTube(t, now);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (this.hintMove) this._drawHint(now);
      this._drawParticles();
    }

    /** Top-left corner + rotation for a tube this frame. */
    _poseOf(t) {
      const g = this.geo;
      if (t.pose) return t.pose;
      const e = t.enter < 1 ? easeOutBack(t.enter) : 1;
      const shake = t.shakeT > 0 ? Math.sin(t.shakeT * 34) * t.shakeT * g.w * 0.16 : 0;
      return {
        cx: t.pos.x + shake,
        cy: t.pos.y - t.lift * g.w * 0.45 - (1 - e) * g.w * 1.2,
        a: 0, kx: 0,
      };
    }

    _tubePath(ctx) {
      const g = this.geo, w = g.w, H = g.H, r = w / 2;
      ctx.beginPath();
      ctx.moveTo(0, -1);
      ctx.lineTo(0, H - r);
      ctx.arc(r, H - r, r, Math.PI, 0, true);
      ctx.lineTo(w, -1);
    }

    _drawTube(t, now) {
      const ctx = this.ctx, g = this.geo, dpr = this.dpr, w = g.w, H = g.H;
      const P = this._poseOf(t);
      const alpha = t.enter < 1 ? clamp(t.enter * 1.6, 0, 1) : 1;
      const setLocal = () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(P.cx, P.cy);
        ctx.rotate(P.a);
        ctx.translate(-P.kx, 0);
      };
      ctx.save();
      ctx.globalAlpha = alpha;
      setLocal();

      // Completion glow.
      if (t.glow > 0 && t.glowColor) {
        ctx.save();
        ctx.shadowColor = t.glowColor;
        ctx.shadowBlur = 30 * t.glow * dpr;
        this._tubePath(ctx); ctx.closePath();
        ctx.fillStyle = rgba(t.glowColor, 0.35 * t.glow);
        ctx.fill();
        ctx.restore();
      }

      // Glass body.
      this._tubePath(ctx); ctx.closePath();
      ctx.fillStyle = 'rgba(170,190,255,0.075)';
      ctx.fill();

      // Liquid.
      if (t.layers.length) {
        ctx.save();
        this._tubePath(ctx); ctx.closePath();
        ctx.clip();
        if (P.a === 0) this._drawLiquidUpright(t, now);
        else this._drawLiquidTilted(t, P, setLocal);
        ctx.restore();
        setLocal();
      }

      // Glass edges and shine.
      const hi = t.lift > 0.05 || t.pose ? 0.85 : 0.5;
      ctx.lineWidth = g.wall;
      ctx.strokeStyle = `rgba(214,226,255,${hi})`;
      this._tubePath(ctx);
      ctx.stroke();
      const sh = ctx.createLinearGradient(0, 0, 0, H);
      sh.addColorStop(0, 'rgba(255,255,255,0.0)');
      sh.addColorStop(0.15, 'rgba(255,255,255,0.28)');
      sh.addColorStop(0.8, 'rgba(255,255,255,0.12)');
      sh.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sh;
      roundRect(ctx, w * 0.16, H * 0.07, Math.max(2, w * 0.1), H * 0.74, w * 0.05);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      roundRect(ctx, w * 0.72, H * 0.12, Math.max(1.5, w * 0.05), H * 0.12, w * 0.03);
      ctx.fill();
      // Lip.
      ctx.fillStyle = `rgba(222,232,255,${hi + 0.1})`;
      roundRect(ctx, -g.wall * 1.3, -g.wall * 0.9, w + g.wall * 2.6, g.wall * 1.9, g.wall);
      ctx.fill();

      // Cork.
      if (t.cork > 0) this._drawCork(t);
      ctx.restore();
    }

    _drawLiquidUpright(t, now) {
      const ctx = this.ctx, g = this.geo, w = g.w, H = g.H;
      let v = 0;
      const total = volume(t.layers);
      const topY = H - total * g.u;
      for (let li = 0; li < t.layers.length; li++) {
        const L = t.layers[li];
        const y1 = H - v * g.u + (li === 0 ? 2 : 0.5), y0 = H - (v + L.v) * g.u;
        const col = PALETTE[L.c];
        ctx.fillStyle = col;
        if (li === t.layers.length - 1 && t.wob > 0.01) {
          const amp = t.wob * g.u * 0.07;
          ctx.beginPath();
          ctx.moveTo(-1, y1);
          for (let k = 0; k <= 8; k++) {
            const x = (w * k) / 8;
            ctx.lineTo(x, y0 + Math.sin(t.wobPhase + k * 0.9) * amp);
          }
          ctx.lineTo(w + 1, y1);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(-1, y0, w + 2, y1 - y0);
        }
        // Symbols for color-blind play, one per whole unit.
        if (this.opts.symbols) {
          for (let u = Math.ceil(v - 1e-3); u + 1 <= v + L.v + 1e-3; u++) {
            const cy = H - (u + 0.5) * g.u;
            drawSymbol(ctx, L.c, w / 2, cy, w * 0.2, luminance(col) > 0.6 ? 'rgba(20,24,50,0.6)' : 'rgba(255,255,255,0.75)');
          }
        }
        v += L.v;
      }
      if (total > 0.01) {
        // Cylindrical shading.
        const gr = ctx.createLinearGradient(0, 0, w, 0);
        gr.addColorStop(0, 'rgba(8,10,40,0.28)');
        gr.addColorStop(0.3, 'rgba(255,255,255,0.08)');
        gr.addColorStop(0.55, 'rgba(255,255,255,0)');
        gr.addColorStop(1, 'rgba(8,10,40,0.34)');
        ctx.fillStyle = gr;
        ctx.fillRect(-1, topY - 3, w + 2, H - topY + 4);
        // Meniscus highlight.
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(-1, topY - 0.5 + (t.wob > 0.01 ? Math.sin(t.wobPhase) * t.wob * g.u * 0.05 : 0), w + 2, Math.max(1.5, g.u * 0.06));
      }
      void now;
    }

    _drawLiquidTilted(t, P, setLocal) {
      const ctx = this.ctx, g = this.geo, dpr = this.dpr, w = g.w;
      const c = Math.cos(P.a), s = Math.sin(P.a);
      const world = g.poly.map(([x, y]) => {
        const dx = x - P.kx;
        return [P.cx + dx * c - y * s, P.cy + dx * s + y * c];
      });
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of world) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      const levelFor = (area) => {
        let lo = minY, hi = maxY;
        for (let k = 0; k < 22; k++) {
          const mid = (lo + hi) / 2;
          if (areaBelow(world, mid) > area) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
      };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let v = 0, yPrev = maxY + 2;
      let topY = maxY;
      for (const L of t.layers) {
        v += L.v;
        const y = levelFor(g.area(v));
        ctx.fillStyle = PALETTE[L.c];
        ctx.fillRect(minX - 2, y, maxX - minX + 4, yPrev - y + 0.6);
        yPrev = y;
        topY = y;
      }
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(minX - 2, topY - 0.5, maxX - minX + 4, Math.max(1.5, g.u * 0.06));
      // Shading along the tube's width, limited to the liquid.
      ctx.beginPath();
      ctx.rect(minX - 2, topY, maxX - minX + 4, maxY - topY + 2);
      ctx.clip();
      setLocal();
      const gr = ctx.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, 'rgba(8,10,40,0.28)');
      gr.addColorStop(0.3, 'rgba(255,255,255,0.08)');
      gr.addColorStop(0.55, 'rgba(255,255,255,0)');
      gr.addColorStop(1, 'rgba(8,10,40,0.34)');
      ctx.fillStyle = gr;
      ctx.fillRect(-1, -1, w + 2, g.H + 2);
    }

    _drawCork(t) {
      const ctx = this.ctx, g = this.geo, w = g.w;
      const k = t.cork;
      const drop = k < 1 ? (1 - easeOutBack(k)) * -g.u * 1.6 : 0;
      const ch = g.neck * 1.05, cw = w * 0.86;
      const x = (w - cw) / 2, y = -ch * 0.42 + drop;
      ctx.save();
      ctx.globalAlpha *= clamp(k * 3, 0, 1);
      const gr = ctx.createLinearGradient(x, 0, x + cw, 0);
      gr.addColorStop(0, '#A7713F');
      gr.addColorStop(0.35, '#DDA86A');
      gr.addColorStop(1, '#94602F');
      ctx.fillStyle = gr;
      roundRect(ctx, x, y, cw, ch, w * 0.12);
      ctx.fill();
      ctx.fillStyle = 'rgba(90,50,20,0.35)';
      for (let i = 1; i <= 3; i++) ctx.fillRect(x + (cw * i) / 4 - 0.5, y + ch * 0.18, 1, ch * 0.2);
      ctx.fillStyle = '#E8B77C';
      roundRect(ctx, x - w * 0.04, y - ch * 0.08, cw + w * 0.08, ch * 0.34, w * 0.1);
      ctx.fill();
      ctx.restore();
    }

    _drawStream(s, now) {
      const ctx = this.ctx, g = this.geo;
      const top = s.tail, bottom = s.head;
      if (bottom - top < 0.5) return;
      const width = Math.max(3, g.w * 0.17);
      const wig = Math.sin(now / 45) * 0.6;
      ctx.fillStyle = PALETTE[s.c];
      ctx.beginPath();
      ctx.moveTo(s.x - width * 0.6, top);
      ctx.lineTo(s.x + width * 0.6, top);
      ctx.lineTo(s.x + width * 0.42 + wig, bottom);
      ctx.lineTo(s.x - width * 0.42 + wig, bottom);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(s.x - width * 0.25 + wig * 0.5, top, Math.max(1, width * 0.18), bottom - top);
    }

    _drawHint(now) {
      const ctx = this.ctx, g = this.geo;
      const [a, b] = this.hintMove;
      const A = this.tubes[a], B = this.tubes[b];
      if (!A || !B) return;
      const pulse = 0.5 + 0.5 * Math.sin(this.hintT / 180);
      // Ring around the source.
      const pa = this._poseOf(A);
      if (!A.pose) {
        ctx.save();
        ctx.strokeStyle = `rgba(255,214,102,${0.45 + 0.45 * pulse})`;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = -now / 40;
        roundRect(ctx, pa.cx - g.w * 0.3, pa.cy - g.w * 0.45, g.w * 1.6, g.H + g.w * 0.75, g.w * 0.8);
        ctx.stroke();
        ctx.restore();
      }
      // Bouncing arrow over the destination.
      const bx = B.pos.x + g.w / 2;
      const by = B.pos.y - B.lift * g.w * 0.45 - g.w * 0.55 - 8 * Math.abs(Math.sin(this.hintT / 260));
      const s = Math.max(9, g.w * 0.32);
      ctx.fillStyle = '#FFD666';
      ctx.beginPath();
      ctx.moveTo(bx - s, by - s);
      ctx.lineTo(bx + s, by - s);
      ctx.lineTo(bx, by);
      ctx.closePath();
      ctx.fill();
    }

    _drawParticles() {
      const ctx = this.ctx;
      for (const p of this.particles) {
        const k = 1 - p.life / p.max;
        ctx.globalAlpha = p.type === 'confetti' ? Math.min(1, k * 4) : k;
        ctx.fillStyle = p.color;
        if (p.type === 'confetti') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6 * Math.abs(Math.cos(p.life / 180 + p.sway)) + 1);
          ctx.restore();
        } else if (p.type === 'spark') {
          const r = p.size * (0.4 + k * 0.6);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + r * 0.35, p.y); ctx.lineTo(p.x, p.y + r); ctx.lineTo(p.x - r * 0.35, p.y);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Distinct shapes so colors can be told apart without hue. */
  function drawSymbol(ctx, c, x, y, s, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, s * 0.28);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    const poly = (n, rot, r) => {
      for (let i = 0; i < n; i++) {
        const a = rot + (Math.PI * 2 * i) / n;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
    };
    switch (c % 14) {
      case 0: ctx.arc(x, y, s * 0.8, 0, Math.PI * 2); ctx.fill(); break; // dot
      case 1: poly(3, -Math.PI / 2, s); ctx.fill(); break; // triangle
      case 2: ctx.rect(x - s * 0.75, y - s * 0.75, s * 1.5, s * 1.5); ctx.fill(); break; // square
      case 3: poly(4, 0, s); ctx.fill(); break; // diamond
      case 4: for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (Math.PI * i) / 5, r = i % 2 ? s * 0.45 : s * 1.05; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); ctx.fill(); break; // star
      case 5: ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke(); break; // plus
      case 6: ctx.arc(x, y, s * 0.75, 0, Math.PI * 2); ctx.stroke(); break; // ring
      case 7: poly(6, 0, s * 0.95); ctx.fill(); break; // hexagon
      case 8: ctx.moveTo(x - s * 0.8, y - s * 0.8); ctx.lineTo(x + s * 0.8, y + s * 0.8); ctx.moveTo(x + s * 0.8, y - s * 0.8); ctx.lineTo(x - s * 0.8, y + s * 0.8); ctx.stroke(); break; // cross
      case 9: poly(3, Math.PI / 2, s); ctx.fill(); break; // down triangle
      case 10: ctx.moveTo(x - s, y - s * 0.4); ctx.lineTo(x + s, y - s * 0.4); ctx.moveTo(x - s, y + s * 0.4); ctx.lineTo(x + s, y + s * 0.4); ctx.stroke(); break; // equals
      case 11: ctx.moveTo(x - s, y + s * 0.5); ctx.lineTo(x, y - s * 0.5); ctx.lineTo(x + s, y + s * 0.5); ctx.stroke(); break; // chevron
      case 12: ctx.arc(x - s * 0.5, y, s * 0.4, 0, Math.PI * 2); ctx.arc(x + s * 0.5, y, s * 0.4, 0, Math.PI * 2); ctx.fill(); break; // two dots
      case 13: ctx.rect(x - s, y - s * 0.3, s * 2, s * 0.6); ctx.fill(); break; // bar
    }
    ctx.restore();
  }

  root.SortBoard = { Board, PALETTE, COLOR_NAMES, drawSymbol, Geo, areaBelow };
})(typeof self !== 'undefined' ? self : this);
