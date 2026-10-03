/*
 * Color Sort core: rules, solver, difficulty analysis and puzzle generation.
 * Shared by the game (main thread), the generator worker and the Node tools.
 *
 * A puzzle is { cap, tubes } where tubes is an array of arrays of color ids,
 * listed bottom → top. Color ids are palette indices (small ints).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SortCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- RNG ----

  function mulberry32(seed) {
    let a = seed >>> 0;
    const rng = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.int = (n) => Math.floor(rng() * n);
    return rng;
  }

  function hashString(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // -------------------------------------------------------------- rules ----
  //
  // Every rules function takes `rules`: either a number (the classic puzzle,
  // every tube holds that many units) or an object:
  //
  //   K        units per color; a tube is finished when it holds K of one color
  //   heights  per-tube capacity (tall and short tubes); default K
  //   only     per-tube color restriction (null = any color)
  //   locks    [{ tube, key }]: tube is sealed until a tube of color `key` is finished
  //   limit    move limit (used by analysis and the UI, not by the move rules)
  //
  // A finished tube is corked: nothing pours out of it. That makes finishing
  // permanent, so a lock's state follows from the position alone.

  const clone = (tubes) => tubes.map((t) => t.slice());
  const top = (t) => t[t.length - 1];

  function topRun(t) {
    const n = t.length;
    if (!n) return 0;
    const c = t[n - 1];
    let run = 1;
    for (let i = n - 2; i >= 0 && t[i] === c; i--) run++;
    return run;
  }

  function isMono(t) {
    for (let i = 1; i < t.length; i++) if (t[i] !== t[0]) return false;
    return true;
  }

  const plainCache = new Map();
  const normCache = new WeakMap();
  /** Normalize rules (number or object) into fast accessors. Cached. */
  function norm(rules) {
    if (rules && rules.__norm) return rules;
    if (typeof rules === 'number') {
      let n = plainCache.get(rules);
      if (!n) {
        n = { __norm: true, K: rules, plain: true, h: () => rules, only: () => -1, locks: null, sig: () => '', spec: rules };
        plainCache.set(rules, n);
      }
      return n;
    }
    let n = normCache.get(rules);
    if (n) return n;
    const K = rules.K || rules.cap;
    const heights = rules.heights && rules.heights.length ? rules.heights : null;
    const only = rules.only && rules.only.some((c) => c != null) ? rules.only : null;
    const locks = rules.locks && rules.locks.length ? rules.locks : null;
    const lockKey = new Map();
    if (locks) for (const l of locks) lockKey.set(l.tube, l.key);
    const h = heights ? (i) => (heights[i] != null ? heights[i] : K) : () => K;
    const o = only ? (i) => (only[i] != null ? only[i] : -1) : () => -1;
    const plain = !heights && !only && !locks;
    n = {
      __norm: true, K, plain, h, only: o, locks, lockKey, limit: rules.limit || null, spec: rules,
      // Tubes with equal signatures are interchangeable; plain tubes sign ''.
      sig: plain ? () => '' : (i) => {
        const hh = h(i), oo = o(i), kk = lockKey.has(i) ? lockKey.get(i) : -1;
        return hh === K && oo < 0 && kk < 0 ? '' : `~${hh}.${oo}.${kk}~`;
      },
    };
    normCache.set(rules, n);
    return n;
  }

  const isComplete = (t, rules) => { const K = typeof rules === 'number' ? rules : norm(rules).K; return t.length === K && isMono(t); };

  /** Indices of tubes that are still locked in this position (null when the puzzle has no locks). */
  function lockedTubes(tubes, rules) {
    const n = norm(rules);
    if (!n.locks) return null;
    const done = new Set();
    for (const t of tubes) if (t.length === n.K && isMono(t)) done.add(t[0]);
    const out = new Set();
    for (const l of n.locks) if (!done.has(l.key)) out.add(l.tube);
    return out;
  }

  function canPour(tubes, rules, a, b, locked) {
    if (a === b) return false;
    const n = norm(rules);
    const A = tubes[a], B = tubes[b];
    if (!A || !B || !A.length || B.length >= n.h(b)) return false;
    if (A.length === n.K && isMono(A)) return false; // corked
    const c = top(A);
    if (B.length && top(B) !== c) return false;
    const o = n.only(b);
    if (o >= 0 && o !== c) return false;
    if (n.locks) {
      const L = locked || lockedTubes(tubes, n);
      if (L.has(a) || L.has(b)) return false;
    }
    return true;
  }

  function pourAmount(tubes, rules, a, b) {
    if (!canPour(tubes, rules, a, b)) return 0;
    return Math.min(topRun(tubes[a]), norm(rules).h(b) - tubes[b].length);
  }

  /** Mutates tubes. Returns the number of units moved (0 if illegal). */
  function pour(tubes, rules, a, b) {
    const n = pourAmount(tubes, rules, a, b);
    for (let i = 0; i < n; i++) tubes[b].push(tubes[a].pop());
    return n;
  }

  /** Pour already known to be legal (solver hot path). */
  function pourUnchecked(tubes, n, a, b) {
    const k = Math.min(topRun(tubes[a]), n.h(b) - tubes[b].length);
    for (let i = 0; i < k; i++) tubes[b].push(tubes[a].pop());
    return k;
  }

  /** Solved: every tube is empty or finished (K units of one color). */
  function isSolved(tubes, rules) {
    const K = typeof rules === 'number' ? rules : norm(rules).K;
    for (const t of tubes) if (t.length && !(t.length === K && isMono(t))) return false;
    return true;
  }

  /** Every legal move, with no pruning (what the player can do). */
  function allMoves(tubes, rules) {
    const n = norm(rules);
    const L = lockedTubes(tubes, n);
    const out = [];
    for (let a = 0; a < tubes.length; a++)
      for (let b = 0; b < tubes.length; b++)
        if (canPour(tubes, n, a, b, L)) out.push([a, b]);
    return out;
  }

  /**
   * Legal moves minus ones that can never help: pouring a single-color tube
   * into an interchangeable empty tube, and choosing between interchangeable
   * empty tubes (only the first of each kind is tried).
   */
  function usefulMoves(tubes, rules) {
    const n = norm(rules);
    const L = lockedTubes(tubes, n);
    const out = [];
    const emptyOk = new Array(tubes.length).fill(false);
    const seenSig = new Set();
    for (let i = 0; i < tubes.length; i++) {
      if (tubes[i].length || (L && L.has(i))) continue;
      const sg = n.sig(i);
      if (!seenSig.has(sg)) { seenSig.add(sg); emptyOk[i] = true; }
    }
    for (let a = 0; a < tubes.length; a++) {
      const A = tubes[a];
      if (!A.length || (A.length === n.K && isMono(A)) || (L && L.has(a))) continue;
      const c = top(A);
      const mono = topRun(A) === A.length;
      for (let b = 0; b < tubes.length; b++) {
        if (a === b) continue;
        const B = tubes[b];
        if (!B.length) {
          if (!emptyOk[b] || (mono && n.sig(a) === n.sig(b))) continue;
        } else if (B.length >= n.h(b) || top(B) !== c || (L && L.has(b))) continue;
        const o = n.only(b);
        if (o >= 0 && o !== c) continue;
        out.push([a, b]);
      }
    }
    return out;
  }

  /**
   * A position's identity. Tubes of the same kind are interchangeable, so the
   * key is the sorted multiset of (kind, contents). Plain tubes have no kind
   * prefix, so classic puzzles keep exactly their old keys.
   */
  function stateKey(tubes, rules) {
    const n = rules != null ? norm(rules) : null;
    const parts = new Array(tubes.length);
    for (let i = 0; i < tubes.length; i++) {
      const t = tubes[i];
      let s = n && !n.plain ? n.sig(i) : '';
      for (let j = 0; j < t.length; j++) s += String.fromCharCode(48 + t[j]);
      parts[i] = s;
    }
    parts.sort();
    return parts.join('|');
  }

  /** Plain JSON-able rules for storage and workers. A number when classic. */
  function rulesSpec(rules) {
    const n = norm(rules);
    if (n.plain && !n.limit) return n.K;
    const out = { K: n.K };
    const s = n.spec;
    if (s.heights && s.heights.length) out.heights = s.heights.slice();
    if (s.only && s.only.some((c) => c != null)) out.only = s.only.slice();
    if (s.locks && s.locks.length) out.locks = s.locks.map((l) => ({ tube: l.tube, key: l.key }));
    if (n.limit) out.limit = n.limit;
    return out;
  }

  /**
   * A stable identity for a puzzle's content, used to key saved progress.
   * Colors are relabeled by first appearance and tubes are sorted, so the
   * same deal gets the same id whatever its position, palette or tube order.
   * Rules are part of the identity (a move limit makes a different puzzle),
   * but classic puzzles hash exactly as they always have.
   */
  function puzzleId(tubes, rules) {
    const n = norm(rules);
    const map = new Map();
    const relabel = (c) => { if (!map.has(c)) map.set(c, map.size); return map.get(c); };
    const relabeled = tubes.map((t) => t.map(relabel));
    let key;
    if (n.plain) {
      key = n.K + ':' + stateKey(relabeled);
    } else {
      const s = n.spec;
      const r = { K: n.K, heights: s.heights, only: s.only && s.only.map((c) => (c == null ? null : relabel(c))),
        locks: s.locks && s.locks.map((l) => ({ tube: l.tube, key: relabel(l.key) })) };
      key = n.K + ':' + stateKey(relabeled, r);
    }
    if (n.limit) key += '#limit' + n.limit;
    return hashString(key).toString(36) + hashString('~' + key).toString(36);
  }

  function countRuns(tubes) {
    let runs = 0;
    for (const t of tubes) for (let i = 0; i < t.length; i++) if (i === 0 || t[i] !== t[i - 1]) runs++;
    return runs;
  }

  function colorCount(tubes) {
    const s = new Set();
    for (const t of tubes) for (const c of t) s.add(c);
    return s.size;
  }

  // ------------------------------------------------------------- solver ----

  class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(n) {
      const a = this.a; a.push(n);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].f < n.f || (a[p].f === n.f && a[p].g >= n.g)) break;
        a[i] = a[p]; i = p;
      }
      a[i] = n;
    }
    pop() {
      const a = this.a, r = a[0], last = a.pop();
      if (a.length) {
        let i = 0; const n = a.length;
        for (;;) {
          let l = 2 * i + 1, m = i;
          let best = last;
          if (l < n && (a[l].f < best.f || (a[l].f === best.f && a[l].g > best.g))) { m = l; best = a[l]; }
          const r2 = l + 1;
          if (r2 < n && (a[r2].f < best.f || (a[r2].f === best.f && a[r2].g > best.g))) { m = r2; best = a[r2]; }
          if (m === i) break;
          a[i] = a[m]; i = m;
        }
        a[i] = last;
      }
      return r;
    }
  }

  /**
   * A* over canonical states. The heuristic is (color runs − colors): a pour
   * can merge at most one run into another, and no pour ever splits a run,
   * so it never overestimates. Tube restrictions and locks only remove
   * moves, so it stays admissible. With weight 1 the first solution is optimal.
   *
   * Returns { solved, moves, expanded, optimal, exhausted }.
   * `exhausted` means the whole reachable space was searched: proof of no solution.
   */
  function solve(start, rules, opts) {
    opts = opts || {};
    const R = norm(rules);
    const limit = opts.limit || 250000;
    const w = opts.weight || 1;
    const nColors = colorCount(start);
    const h = (t) => countRuns(t) - nColors;

    const root = { tubes: clone(start), g: 0, f: 0, parent: null, move: null };
    root.f = w * h(root.tubes);
    const open = new Heap();
    open.push(root);
    const best = new Map([[stateKey(root.tubes, R), 0]]);
    let expanded = 0;

    while (open.size) {
      const node = open.pop();
      const k = stateKey(node.tubes, R);
      if (best.get(k) < node.g) continue; // stale entry
      if (isSolved(node.tubes, R)) {
        const moves = [];
        for (let n = node; n.parent; n = n.parent) moves.push(n.move);
        moves.reverse();
        return { solved: true, moves, expanded, optimal: w === 1, exhausted: false };
      }
      if (++expanded > limit) return { solved: false, moves: null, expanded, optimal: false, exhausted: false };
      for (const [a, b] of usefulMoves(node.tubes, R)) {
        const t = clone(node.tubes);
        pourUnchecked(t, R, a, b);
        const ck = stateKey(t, R);
        const g = node.g + 1;
        const prev = best.get(ck);
        if (prev !== undefined && prev <= g) continue;
        best.set(ck, g);
        open.push({ tubes: t, g, f: g + w * h(t), parent: node, move: [a, b] });
      }
    }
    return { solved: false, moves: null, expanded, optimal: false, exhausted: true };
  }

  /** Fast search first; exact A* only when the state space allows it. */
  function bestSolution(tubes, rules, exactLimit) {
    const quick = solve(tubes, rules, { weight: 3, limit: 60000 });
    if (!quick.solved) {
      if (quick.exhausted) return quick;
      const deep = solve(tubes, rules, { weight: 1.5, limit: 300000 });
      return deep;
    }
    const exact = solve(tubes, rules, { weight: 1, limit: exactLimit || 150000 });
    if (exact.solved && exact.moves.length <= quick.moves.length) return exact;
    return quick;
  }

  // --------------------------------------------------- simulated players ----

  /**
   * How a casual player values a move. Merging onto the same color and
   * finishing tubes look good; spending an empty tube looks costly.
   * The player sees one move ahead, like most people do.
   */
  function moveAppeal(tubes, R, a, b) {
    const A = tubes[a], B = tubes[b];
    const run = topRun(A);
    const n = Math.min(run, R.h(b) - B.length);
    let s = 0;
    if (B.length) {
      s += 2;
      if (n === run) s += 1; // whole run moves, source reveals a new color
      if (B.length + n === R.K && isMono(B)) s += 3; // completes a tube
      if (isMono(B)) s += 0.5;
    } else {
      s -= R.only(b) >= 0 ? 0.5 : 1.5; // using up free space (a reserved tube costs less)
      if (n === A.length) s -= 2;
    }
    if (n === A.length) s += 0.75; // frees a tube
    if (n < run) s -= 1; // splits a run
    return s;
  }

  /**
   * One play-through by a noisy greedy player with no undo. It never repeats
   * a position; it fails when it runs out of fresh moves (or of moves allowed).
   */
  function rollout(start, rules, rng, temperature, maxDepth) {
    const R = norm(rules);
    const T = temperature || 0.9;
    const tubes = clone(start);
    const seen = new Set([stateKey(tubes, R)]);
    let moves = 0;
    const maxMoves = Math.min(400, maxDepth || 400);
    while (moves <= maxMoves) {
      if (isSolved(tubes, R)) return { solved: true, moves };
      if (moves === maxMoves) break;
      const options = [];
      for (const [a, b] of usefulMoves(tubes, R)) {
        const t = clone(tubes);
        pourUnchecked(t, R, a, b);
        const k = stateKey(t, R);
        if (seen.has(k)) continue;
        options.push({ a, b, k, s: moveAppeal(tubes, R, a, b) });
      }
      if (!options.length) return { solved: false, moves };
      let max = -Infinity;
      for (const o of options) if (o.s > max) max = o.s;
      let sum = 0;
      for (const o of options) { o.p = Math.exp((o.s - max) / T); sum += o.p; }
      let r = rng() * sum, pick = options[options.length - 1];
      for (const o of options) { r -= o.p; if (r <= 0) { pick = o; break; } }
      pourUnchecked(tubes, R, pick.a, pick.b);
      seen.add(pick.k);
      moves++;
    }
    return { solved: false, moves };
  }

  /**
   * A player who plays the same greedy-with-noise way but uses undo: when
   * they run out of fresh moves they step back and try their next idea.
   * Returns the total moves spent, undos included (a depth-first search whose
   * move order is the player's preference, perturbed with Gumbel noise).
   * With a move limit, lines longer than the limit count as dead ends.
   */
  function explore(start, rules, rng, temperature, budget, maxDepth) {
    const R = norm(rules);
    const T = temperature || 0.9;
    const maxEffort = budget || 4000;
    const depthCap = maxDepth || Infinity;
    // Position → shallowest depth reached. Without a limit, any repeat is skipped.
    const seen = new Map([[stateKey(start, R), 0]]);
    const frame = (tubes, depth) => {
      if (isSolved(tubes, R)) return { tubes, opts: null, i: 0 };
      const opts = depth >= depthCap ? [] : usefulMoves(tubes, R).map(([a, b]) => ({
        a, b, r: moveAppeal(tubes, R, a, b) / T - Math.log(-Math.log(rng() || 1e-12)),
      }));
      opts.sort((x, y) => y.r - x.r);
      return { tubes, opts, i: 0 };
    };
    const stack = [frame(clone(start), 0)];
    let effort = 0;
    while (stack.length && effort < maxEffort) {
      const f = stack[stack.length - 1];
      if (!f.opts) return { solved: true, effort, depth: stack.length - 1 };
      let next = null;
      while (f.i < f.opts.length) {
        const o = f.opts[f.i++];
        const t = clone(f.tubes);
        pourUnchecked(t, R, o.a, o.b);
        const k = stateKey(t, R);
        const depth = stack.length;
        const d = seen.get(k);
        if (d !== undefined && (depthCap === Infinity || d <= depth)) continue;
        seen.set(k, depth);
        next = t;
        break;
      }
      effort++; // a pour forward, or an undo back
      if (next) stack.push(frame(next, stack.length));
      else stack.pop();
    }
    return { solved: false, effort: maxEffort };
  }

  /**
   * Difficulty analysis.
   *
   *  par      shortest (or best found) solution length
   *  limit    move limit, when opts.moveLimit is set (a number, or a function of par)
   *  success  fraction of simulated casual players who win on the first try, no undo
   *  effort   mean moves (undos included) a casual player who backtracks spends
   *  trick    effort / par: how misleading the position is, independent of size
   *  score    log2(effort): the difficulty number. +1 means twice the work.
   */
  function analyze(tubes, rules, opts) {
    opts = opts || {};
    const R = norm(rules);
    const rng = opts.rng || mulberry32(hashString(stateKey(tubes, R)));
    const sol = opts.solution || bestSolution(tubes, R, opts.exactLimit);
    if (!sol.solved) return null;
    const par = sol.moves.length;
    const limit = typeof opts.moveLimit === 'function' ? opts.moveLimit(par) : opts.moveLimit || null;
    const Rn = opts.rollouts || 32;
    let wins = 0;
    for (let i = 0; i < Rn; i++) if (rollout(tubes, R, rng, opts.temperature, limit).solved) wins++;
    const E = opts.explorers || 16;
    let effort = 0;
    for (let i = 0; i < E; i++) effort += explore(tubes, R, rng, opts.temperature, undefined, limit).effort;
    effort /= E;
    return {
      par,
      limit,
      optimal: sol.optimal,
      solution: sol.moves,
      success: wins / Rn,
      effort,
      trick: effort / Math.max(1, par),
      score: Math.log2(Math.max(1, effort)),
    };
  }

  // ---------------------------------------------------------- generator ----

  /** A shuffled classic puzzle. No tube starts finished. */
  function randomPuzzle(rng, spec) {
    const { colors, cap, empties } = spec;
    const palette = spec.palette || [...Array(colors).keys()];
    for (let tries = 0; tries < 200; tries++) {
      const pool = [];
      for (let c = 0; c < colors; c++) for (let k = 0; k < cap; k++) pool.push(palette[c]);
      shuffle(pool, rng);
      const tubes = [];
      for (let i = 0; i < colors; i++) tubes.push(pool.slice(i * cap, i * cap + cap));
      if (tubes.some((t) => isMono(t))) continue;
      // A tube that starts with cap−1 of one color is a gift; keep them rare.
      if (tubes.filter((t) => topRun(t) >= cap - 1).length > 1) continue;
      for (let e = 0; e < empties; e++) tubes.push([]);
      return tubes;
    }
    throw new Error('could not build puzzle');
  }

  /**
   * A deal with optional mechanics. Returns { tubes, rules }.
   *   spec.heights  'mixed': filled and spare tubes get varied heights
   *   spec.only     number of extra empty tubes reserved for one color
   *   spec.locks    number of filled tubes sealed until another color is finished
   *   spec.limit    true: a move limit (set from par by generate)
   * Without mechanics this is randomPuzzle, with the same random draws.
   */
  function randomDeal(rng, spec) {
    const K = spec.cap;
    if (!spec.heights && !spec.only && !spec.locks) return { tubes: randomPuzzle(rng, spec), rules: K };
    const { colors, empties } = spec;
    const palette = spec.palette || [...Array(colors).keys()];
    for (let tries = 0; tries < 300; tries++) {
      // Heights of the filled tubes: trade capacity between pairs so the total stays colors × K.
      const H = new Array(colors).fill(K);
      if (spec.heights) {
        const swaps = Math.max(2, Math.round(colors * 0.5));
        for (let s = 0; s < swaps; s++) {
          const i = rng.int(colors), j = rng.int(colors);
          const d = rng() < 0.3 ? 2 : 1;
          if (i !== j && H[i] + d <= K + 2 && H[j] - d >= 2) { H[i] += d; H[j] -= d; }
        }
      }
      const pool = [];
      for (let c = 0; c < colors; c++) for (let k = 0; k < K; k++) pool.push(palette[c]);
      shuffle(pool, rng);
      const tubes = [];
      let at = 0;
      for (let i = 0; i < colors; i++) { tubes.push(pool.slice(at, at + H[i])); at += H[i]; }
      if (tubes.some((t) => t.length >= 2 && isMono(t))) continue;
      if (tubes.filter((t) => topRun(t) >= K - 1).length > 1) continue;
      const heights = H.slice();
      for (let e = 0; e < empties; e++) {
        tubes.push([]);
        heights.push(spec.heights ? [K - 1, K, K + 1, K + 2][rng.int(4)] : K);
      }
      if (spec.heights && !heights.some((h, i) => i >= colors && h >= K)) heights[colors] = K; // keep one usable spare
      const only = new Array(tubes.length).fill(null);
      if (spec.only) {
        const picks = shuffle(palette.slice(0, colors), rng).slice(0, spec.only);
        for (const c of picks) { tubes.push([]); heights.push(K); only.push(c); }
      }
      const locks = [];
      if (spec.locks) {
        const candidates = shuffle([...Array(colors).keys()], rng);
        for (const ti of candidates) {
          if (locks.length >= spec.locks) break;
          const inside = new Set(tubes[ti]);
          const keys = palette.slice(0, colors).filter((c) => !inside.has(c) && !locks.some((l) => l.key === c));
          if (keys.length) locks.push({ tube: ti, key: keys[rng.int(keys.length)] });
        }
        if (locks.length < spec.locks) continue;
      }
      const rules = { K };
      if (spec.heights) rules.heights = heights;
      if (spec.only) rules.only = only;
      if (locks.length) rules.locks = locks;
      return { tubes, rules };
    }
    throw new Error('could not build puzzle');
  }

  /** Move limit for limit levels: room for a few non-optimal moves. */
  const moveLimitFor = (par) => Math.ceil(par * 1.25) + 1;

  /** Choose which palette colors a level uses: distinct first, then the rest. */
  function pickPalette(rng, n, paletteSize) {
    const idx = shuffle([...Array(paletteSize).keys()], rng);
    return idx.slice(0, n);
  }

  /**
   * Build `candidates` solvable puzzles for a spec, rank them by difficulty
   * score and take the one at `percentile` (0 = easiest of the batch,
   * 1 = hardest). A `target` picks the candidate closest to that score.
   * Mechanics in the spec (heights, only, locks, limit) are dealt by randomDeal.
   */
  function generate(spec, seed, opts) {
    opts = opts || {};
    const rng = mulberry32(seed);
    const n = opts.candidates || 24;
    const paletteSize = opts.paletteSize || 14;
    const list = [];
    let guard = 0;
    while (list.length < n && guard++ < n * 8) {
      const palette = pickPalette(rng, spec.colors, paletteSize);
      const deal = randomDeal(rng, { ...spec, palette });
      const a = analyze(deal.tubes, deal.rules, {
        rng: mulberry32(rng.int(1 << 30)),
        rollouts: opts.rollouts,
        explorers: opts.explorers,
        exactLimit: opts.exactLimit,
        moveLimit: spec.limit ? moveLimitFor : undefined,
      });
      if (!a) continue;
      if (spec.minPar && a.par < spec.minPar) continue;
      list.push({ deal, analysis: a });
    }
    if (!list.length) throw new Error('no solvable candidates');
    list.sort((x, y) => x.analysis.score - y.analysis.score);
    let pick;
    const target = opts.target != null ? opts.target : spec.target;
    if (target != null) {
      pick = list.reduce((b, c) => (Math.abs(c.analysis.score - target) < Math.abs(b.analysis.score - target) ? c : b));
    } else {
      const p = spec.percentile != null ? spec.percentile : 0.5;
      pick = list[Math.min(list.length - 1, Math.round(p * (list.length - 1)))];
    }
    const an = pick.analysis;
    let rules = pick.deal.rules;
    // Candidates are screened with a small exact-search budget. Spend a big one on
    // the winner, so "fewest moves" is the true minimum and says so when proven.
    let par = an.par, optimal = an.optimal;
    if (!optimal && opts.finalExactLimit) {
      const exact = solve(pick.deal.tubes, rules, { weight: 1, limit: opts.finalExactLimit });
      if (exact.solved) { par = Math.min(par, exact.moves.length); optimal = true; }
    }
    if (an.limit) rules = Object.assign(typeof rules === 'number' ? { K: rules } : { ...rules }, { limit: an.limit });
    return {
      cap: spec.cap,
      tubes: pick.deal.tubes,
      rules: rulesSpec(rules),
      par,
      optimal,
      score: +an.score.toFixed(2),
      success: +an.success.toFixed(2),
      spread: [+list[0].analysis.score.toFixed(2), +list[list.length - 1].analysis.score.toFixed(2)],
    };
  }

  // ------------------------------------------------------ level design ----

  /**
   * Difficulty spread by puzzle size: [p10, p50, p90] of score over random
   * puzzles, per tube height and color count. Regenerate with
   * `node tools/calibrate.js 40` after changing the analysis.
   */
  const SIZE_TABLE = {"4":{"3":[2.63,3.22,3.45],"4":[3.52,3.76,3.98],"5":[3.97,4.12,4.4],"6":[4.29,4.5,4.86],"7":[4.67,4.91,5.41],"8":[5.08,5.58,6.29],"9":[5.34,6.23,7.23],"10":[5.71,6.52,7.95],"11":[6.06,7.03,8.18],"12":[6.55,7.99,9.87],"13":[6.97,8.61,10.75],"14":[7.71,9.13,11.28]},"5":{"5":[4.3,4.56,4.78],"6":[4.79,4.96,5.38],"7":[4.86,5.49,6.45],"8":[5.48,6.13,7.25],"9":[5.93,6.67,7.99],"10":[6.46,7.46,9.36],"11":[7.49,8.62,10.81],"12":[7.62,9.47,10.75]}};

  /**
   * Pick a color count whose typical range covers the target score. Among
   * sizes that cover it, prefer the one where the target sits a bit above
   * the median: a trickier small puzzle beats a bland big one. `jitter`
   * (0–1, with an rng) adds variety for endless play.
   */
  function sizeForTarget(target, cap, minColors, maxColors, rng, jitter) {
    const row = SIZE_TABLE[cap] || SIZE_TABLE[4];
    let best = null;
    for (const key of Object.keys(row)) {
      const c = +key;
      if (c < (minColors || 3) || c > (maxColors || 14)) continue;
      const [p10, p50, p90] = row[key];
      const aim = p50 + (p90 - p50) * 0.35;
      let cost = Math.abs(target - aim);
      if (target > p90) cost += (target - p90) * 3;
      if (target < p10) cost += (p10 - target) * 3;
      if (rng && jitter) cost += rng() * jitter;
      if (!best || cost < best.cost) best = { c, cost };
    }
    return best ? best.c : minColors || 4;
  }

  /**
   * The campaign curve: a target score per level.
   *
   *   target(L) = 3.2 + 6.1 · ((L−1)/199)^0.42   (climbs fast, then eases off)
   *             + beat offset                     (the rhythm within each ten)
   *
   * The tutorial is separate, so level 1 is a real (gentle) puzzle and the
   * climb is quick: level 20 sits around 5.5, about 9 colors and 11 tubes.
   * Every block of ten follows the same beat: warm up, climb, a breather,
   * climb, a hard one, a breather, then a boss. Swings reach full size by 20.
   */
  const BEAT = [
    { d: -0.15, kind: 'normal' },
    { d: 0, kind: 'normal' },
    { d: 0.2, kind: 'normal' },
    { d: -0.9, kind: 'breather' },
    { d: 0.1, kind: 'normal' },
    { d: 0.3, kind: 'normal' },
    { d: 0.7, kind: 'hard' },
    { d: -0.8, kind: 'breather' },
    { d: 0.3, kind: 'normal' },
    { d: 1.2, kind: 'boss' },
  ];
  const TOTAL_LEVELS = 200;

  function campaignTarget(level) {
    const beat = BEAT[(level - 1) % 10];
    const x = (Math.min(level, TOTAL_LEVELS) - 1) / (TOTAL_LEVELS - 1);
    const ramp = 3.2 + 6.1 * Math.pow(x, 0.42);
    const swing = 0.4 + 0.6 * Math.min(1, level / 20);
    return ramp + beat.d * swing;
  }

  function campaignSpec(level) {
    const beat = BEAT[(level - 1) % 10];
    const target = campaignTarget(level);
    // Every other boss from level 30 swaps width for height: fewer, taller tubes.
    const cap = level >= 30 && beat.kind === 'boss' && (level / 10) % 2 === 1 ? 5 : 4;
    // The board grows quickly: 6+ colors (8+ tubes) are routine by level 12.
    const minColors = Math.max(3, Math.min(10, 3 + Math.floor((level + 2) / 5)) - (beat.kind === 'breather' ? 1 : 0));
    const colors = sizeForTarget(target, cap, cap === 5 ? Math.max(5, minColors - 2) : minColors, 14);
    return { colors, cap, empties: 2, target: +target.toFixed(2), kind: beat.kind };
  }

  /**
   * Average score each mechanic adds at the same board size
   * (node tools/calibrate-mechanics.js). Combinations are treated as additive.
   */
  const MECHANIC_OFFSET = {"heights":0.3,"only":0.26,"locks":0.5,"limit":0.62};
  const MECHANIC_SPEC = {
    heights: { heights: 'mixed' },
    only: { only: 1, empties: 1 },
    locks: { locks: 1 },
    limit: { limit: true },
  };

  /** A generation spec for a mechanic level aimed at `target`. */
  function mechanicSpec(mechanics, target, minColors, kind) {
    const extra = Object.assign({}, ...mechanics.map((m) => MECHANIC_SPEC[m]));
    const offset = mechanics.reduce((a, m) => a + (MECHANIC_OFFSET[m] || 0), 0);
    const colors = sizeForTarget(target - offset, 4, minColors, 12);
    return Object.assign({ colors, cap: 4, empties: 2, target: +target.toFixed(2), kind: kind || 'normal' }, extra);
  }

  /** Endless tiers: named stops on the same score scale. */
  const TIERS = [
    { name: 'Relaxed', target: 3.7 },
    { name: 'Easy', target: 4.6 },
    { name: 'Medium', target: 5.7 },
    { name: 'Tricky', target: 6.9 },
    { name: 'Hard', target: 8.1 },
    { name: 'Expert', target: 9.3 },
  ];

  /** Auto mode: a continuous dial (0 … TIERS.length) mapped onto the score scale. */
  const autoTarget = (dial) => 3.4 + Math.max(0, Math.min(TIERS.length, dial)) * 1.15;

  /** A spec for any target score, with a little variety in board shape. */
  function specForTarget(target, rng, kind) {
    const cap = target > 6 && rng() < 0.25 ? 5 : 4;
    const colors = sizeForTarget(target, cap, 3, 14, rng, 0.6);
    return { colors, cap, empties: 2, target: +target.toFixed(2), kind: kind || 'endless' };
  }

  function tierSpec(tier, rng) {
    const t = TIERS[Math.max(0, Math.min(TIERS.length - 1, tier))];
    return specForTarget(t.target, rng, t.name.toLowerCase());
  }

  /** Map a score to a 1–10 difficulty rating for display. */
  function rating(score) {
    const r = 1 + (score - 2.9) * 1.15;
    return Math.max(1, Math.min(10, Math.round(r)));
  }

  // ------------------------------------------------ background tasks ----

  /** Work the game hands to a Web Worker (or runs inline as a fallback). */
  const tasks = {
    generate({ spec, seed, candidates }) {
      // Lighter analysis than the offline build: fast enough to run between puzzles.
      return generate(spec, seed, { candidates: candidates || 14, rollouts: 16, explorers: 10, exactLimit: 60000, finalExactLimit: 250000 });
    },
    /**
     * Next move toward a solution, or proof that none exists from here.
     * With `remaining` (moves left under a limit), a solution that is too long counts as none.
     */
    hint({ tubes, cap, remaining }) {
      // Optimal when the search is small, otherwise a fast near-optimal path.
      let r = solve(tubes, cap, { weight: 1, limit: remaining != null ? 40000 : 6000 });
      if (!r.solved && !r.exhausted) r = solve(tubes, cap, { weight: 2, limit: 250000 });
      if (r.solved && remaining != null && r.moves.length > remaining) return { status: 'over', left: r.moves.length };
      if (r.solved) return { status: r.moves.length ? 'move' : 'solved', move: r.moves[0], left: r.moves.length };
      return { status: r.exhausted ? 'dead' : 'unknown' };
    },
    /** Given earlier positions (most recent first), the first one that can still be solved (within its remaining moves). */
    rescue({ states, cap, remaining }) {
      for (let i = 0; i < states.length; i++) {
        const r = solve(states[i], cap, { weight: remaining ? 1.5 : 3, limit: 60000 });
        if (r.solved && (!remaining || r.moves.length <= remaining[i])) return { back: i + 1 };
      }
      return { back: states.length };
    },
  };

  return {
    tasks,
    mulberry32, hashString, shuffle,
    clone, top, topRun, isMono, isComplete, canPour, pourAmount, pour, isSolved,
    allMoves, usefulMoves, stateKey, puzzleId, countRuns, colorCount,
    norm, rulesSpec, lockedTubes, moveLimitFor,
    solve, bestSolution, rollout, explore, analyze,
    randomPuzzle, randomDeal, generate, mechanicSpec, MECHANIC_OFFSET, campaignSpec, campaignTarget, tierSpec, specForTarget, sizeForTarget, autoTarget,
    TIERS, SIZE_TABLE, TOTAL_LEVELS, rating,
  };
});
