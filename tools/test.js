#!/usr/bin/env node
/*
 * Checks the rules, the solver and every shipped level.
 *   node tools/test.js
 */
const assert = require('assert');
const C = require('../js/core.js');
const LEVELS = require('../js/levels.js');

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; } catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
};

test('pour onto the same color moves the whole run, as much as fits', () => {
  const t = [[1, 2, 2, 2], [3, 2], []];
  assert.strictEqual(C.pour(t, 4, 0, 1), 2);
  assert.deepStrictEqual(t, [[1, 2], [3, 2, 2, 2], []]);
});

test('pour into an empty tube moves the whole run', () => {
  const t = [[1, 2, 2], []];
  assert.strictEqual(C.pour(t, 4, 0, 1), 2);
  assert.deepStrictEqual(t, [[1], [2, 2]]);
});

test('illegal pours do nothing', () => {
  const t = [[1, 2], [1, 3], [1, 1, 1, 1]];
  assert.strictEqual(C.pour(t, 4, 0, 1), 0); // colors differ
  assert.strictEqual(C.pour(t, 4, 0, 2), 0); // full
  assert.strictEqual(C.pour(t, 4, 0, 0), 0); // same tube
  assert.deepStrictEqual(t, [[1, 2], [1, 3], [1, 1, 1, 1]]);
});

test('solved means every tube empty or full of one color', () => {
  assert.ok(C.isSolved([[1, 1, 1, 1], [], [2, 2, 2, 2]], 4));
  assert.ok(!C.isSolved([[1, 1], [1, 1], [2, 2, 2, 2]], 4));
});

test('state key ignores tube order', () => {
  assert.strictEqual(C.stateKey([[1, 2], [3], []]), C.stateKey([[], [3], [1, 2]]));
});

test('A* finds the known optimum on a small puzzle', () => {
  // Brute-force BFS for comparison.
  const start = [[1, 2, 1, 2], [2, 1, 2, 1], [], []];
  const seen = new Set([C.stateKey(start)]);
  let frontier = [start], depth = 0, bfs = -1;
  while (frontier.length && bfs < 0) {
    const next = [];
    for (const s of frontier) {
      if (C.isSolved(s, 4)) { bfs = depth; break; }
      for (const [a, b] of C.allMoves(s, 4)) {
        const t = C.clone(s); C.pour(t, 4, a, b);
        const k = C.stateKey(t);
        if (!seen.has(k)) { seen.add(k); next.push(t); }
      }
    }
    frontier = next; depth++;
  }
  const r = C.solve(start, 4);
  assert.ok(r.solved && r.optimal);
  assert.strictEqual(r.moves.length, bfs);
});

test('solver proves a dead end', () => {
  const dead = [[2, 0, 1, 0], [2, 1, 1, 0], [1, 0], [2, 2]];
  const r = C.solve(dead, 4);
  assert.ok(!r.solved && r.exhausted);
});

test('generator hits a target score', () => {
  const spec = { colors: 8, cap: 4, empties: 2, target: 5.8 };
  const p = C.generate(spec, 42, { candidates: 16 });
  assert.ok(Math.abs(p.score - 5.8) < 0.6, `score ${p.score}`);
});

const decode = (L) => L.t.split(',').map((s) => Array.from(s, (ch) => ch.charCodeAt(0) - 97));
const rulesOf = (L) => (L.r ? { K: L.c, ...L.r } : L.c);
test(`all ${LEVELS.length} levels are well-formed and solvable in par`, () => {
  LEVELS.forEach((L, i) => {
    const tubes = decode(L);
    const counts = {};
    const h = (k) => (L.r && L.r.heights && L.r.heights[k] != null ? L.r.heights[k] : L.c);
    tubes.forEach((t, k) => { assert.ok(t.length <= h(k), `level ${i + 1}: overfull tube`); for (const c of t) counts[c] = (counts[c] || 0) + 1; });
    for (const c in counts) assert.strictEqual(counts[c], L.c, `level ${i + 1}: color ${c} has ${counts[c]} units`);
    const rules = rulesOf(L);
    const r = C.solve(tubes, rules, { weight: 3, limit: 400000 });
    assert.ok(r.solved, `level ${i + 1} unsolvable`);
    // Replay the solution through the rules to be sure it is legal.
    const t = C.clone(tubes);
    for (const [a, b] of r.moves) assert.ok(C.pour(t, rules, a, b) > 0, `level ${i + 1}: illegal move`);
    assert.ok(C.isSolved(t, rules));
    if (L.r && L.r.limit) assert.ok(L.p <= L.r.limit, `level ${i + 1}: par ${L.p} over its move limit ${L.r.limit}`);
    assert.ok(r.moves.length >= L.p, `level ${i + 1}: found ${r.moves.length} < recorded best ${L.p}`);
  });
});

test('every level\'s fewest-moves count is proven optimal', () => {
  // The build proves it with a deep exact search; tools/verify-pars.js re-checks it.
  const unproven = LEVELS.map((L, i) => (L.o ? 0 : i + 1)).filter(Boolean);
  assert.deepStrictEqual(unproven, [], `levels without a proven minimum: ${unproven.join(', ')}`);
});

test('level ids are unique and match their content', () => {
  const seen = new Set();
  LEVELS.forEach((L, i) => {
    assert.ok(L.id, `level ${i + 1}: missing id`);
    assert.strictEqual(L.id, C.puzzleId(decode(L), rulesOf(L)), `level ${i + 1}: id does not match content`);
    assert.ok(!seen.has(L.id), `level ${i + 1}: duplicate id`);
    seen.add(L.id);
  });
});

test('puzzle id ignores tube order and color labels', () => {
  const a = [[0, 1, 1, 0], [1, 0, 0, 1], []];
  const b = [[], [5, 3, 3, 5], [3, 5, 5, 3]];
  assert.strictEqual(C.puzzleId(a, 4), C.puzzleId(b, 4));
  assert.notStrictEqual(C.puzzleId(a, 4), C.puzzleId([[0, 1, 1, 1], [1, 0, 0, 0], []], 4));
});

test('v1 saves migrate to content-keyed progress', () => {
  global.self = global;
  require('../js/migrations.js');
  const d = global.SortSave.migrate({ unlocked: 3, stars: { 1: 3, 2: 1 }, best: { 1: 9 }, settings: {} }, C);
  assert.strictEqual(d.v, global.SortSave.SCHEMA);
  assert.strictEqual(Object.keys(d.progress).length, 2);
  assert.deepStrictEqual(Object.values(d.progress)[0], { stars: 3, best: 9 });
  assert.ok(d.tutorialDone && !d.stars && !d.unlocked);
});

test('syncing two devices keeps every solve and the newer unfinished puzzle', () => {
  global.self = global;
  require('../js/migrations.js');
  const S = global.SortSave;
  const phone = {
    v: 2, tutorialDone: true, newSince: 3, newsSeen: 3,
    progress: { a: { stars: 3, best: 10 }, b: { stars: 1, best: 30 } },
    settings: { sound: true },
    endless: { auto: 2, choice: 'auto', solved: 5, streak: 2 },
    daily: { done: { '2026-10-01': 3 }, streak: 1, last: '2026-10-01' },
    session: { mode: 'campaign' }, sessionAt: 200,
  };
  const laptop = {
    v: 2, tutorialDone: false, newSince: 1, newsSeen: 2,
    progress: { b: { stars: 2, best: 40 }, c: { stars: 3, best: 8 } },
    settings: { sound: false },
    endless: { auto: 3, choice: '1', solved: 9, streak: 4 },
    daily: { done: { '2026-09-30': 2, '2026-10-02': 1 }, streak: 1, last: '2026-10-02' },
    session: { mode: 'daily' }, sessionAt: 100,
  };
  const m = S.merge(phone, laptop, 'u');
  assert.deepStrictEqual(m.progress, { a: { stars: 3, best: 10 }, b: { stars: 2, best: 30 }, c: { stars: 3, best: 8 } });
  assert.ok(m.tutorialDone);
  assert.deepStrictEqual([m.newSince, m.newsSeen], [1, 3]);
  assert.deepStrictEqual(m.settings, { sound: true }, 'settings stay per device');
  assert.deepStrictEqual(m.endless, { auto: 3, choice: 'auto', solved: 9, streak: 4 });
  assert.deepStrictEqual(m.daily, { done: { '2026-09-30': 2, '2026-10-01': 3, '2026-10-02': 1 }, late: {}, streak: 3, last: '2026-10-02' });
  assert.deepStrictEqual(m.session, { mode: 'campaign' });
  // A finished puzzle (session cleared later) beats an older unfinished one.
  assert.strictEqual(S.merge({ ...phone, session: null, sessionAt: 300 }, laptop, 'u').session, null);
});

test('daily catch-ups merge, but never count toward the streak', () => {
  global.self = global;
  require('../js/migrations.js');
  const S = global.SortSave;
  const a = { v: 2, progress: {}, settings: {}, endless: {}, daily: { done: { '2026-10-03': 3 }, late: { '2026-10-01': 2, '2026-09-30': 1 }, streak: 1, last: '2026-10-03' } };
  const b = { v: 2, progress: {}, settings: {}, endless: {}, daily: { done: { '2026-10-01': 1 }, late: { '2026-09-30': 3 }, streak: 1, last: '2026-10-01' } };
  const d = S.merge(a, b, 'u').daily;
  assert.deepStrictEqual(d.late, { '2026-09-30': 3 }, 'a day solved on time anywhere leaves the catch-up list');
  assert.deepStrictEqual(d.done, { '2026-10-01': 1, '2026-10-03': 3 });
  assert.strictEqual(d.streak, 1, 'Oct 2 was never solved, so the streak is just Oct 3');
});

test('a reset made while signed in wins over devices that synced before it', () => {
  global.self = global;
  require('../js/migrations.js');
  const S = global.SortSave;
  const account = { v: 2, progress: {}, resetAt: 500, syncedAs: 'u', settings: {}, daily: { done: {} }, endless: {} };
  const stale = { v: 2, progress: { a: { stars: 3 } }, syncedAs: 'u', settings: { sound: true }, daily: { done: {} }, endless: {} };
  const m = S.merge(stale, account, 'u');
  assert.deepStrictEqual(m.progress, {});
  assert.deepStrictEqual(m.settings, { sound: true });
  // A device that never synced with this account keeps its own solves.
  const fresh = { ...stale, syncedAs: undefined };
  assert.deepStrictEqual(S.merge(fresh, account, 'u').progress, { a: { stars: 3 } });
});

test('every shipped puzzle is still in the campaign (or deliberately retired)', () => {
  const fs = require('fs');
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean) : []);
  const shipped = read(__dirname + '/shipped-ids.txt');
  const retired = new Set(read(__dirname + '/retired-ids.txt'));
  const now = new Set(LEVELS.map((L) => L.id));
  assert.ok(shipped.length >= 200, 'shipped-ids.txt looks empty');
  const gone = shipped.filter((id) => !now.has(id) && !retired.has(id));
  assert.deepStrictEqual(gone, [], `${gone.length} shipped puzzles vanished; players have progress on them`);
  assert.ok(LEVELS.every((L) => fs.readFileSync(__dirname + '/shipped-ids.txt', 'utf8').includes(L.id)), 'a level is missing from shipped-ids.txt');
});

test('classic puzzle ids never change (pinned)', () => {
  // If this fails, every player's saved stars would be orphaned.
  assert.strictEqual(C.puzzleId([[0, 1, 1, 0], [1, 0, 0, 1], [], []], 4), '1i2u9xdkc0vol');
  assert.strictEqual(LEVELS[0].id, C.puzzleId(decode(LEVELS[0]), 4));
  assert.strictEqual(C.puzzleId(decode(LEVELS[0]), 4), C.puzzleId(decode(LEVELS[0]), { K: 4 }), 'plain rules object must hash like a number');
});

test('rules affect identity: a move limit or tube kinds make a different puzzle', () => {
  const t = [[0, 1, 1, 0], [1, 0, 0, 1], [], []];
  const base = C.puzzleId(t, 4);
  assert.notStrictEqual(C.puzzleId(t, { K: 4, limit: 9 }), base);
  assert.notStrictEqual(C.puzzleId(t, { K: 4, heights: [4, 4, 5, 4] }), base);
  assert.notStrictEqual(C.puzzleId(t, { K: 4, only: [null, null, 0, null] }), base);
  assert.notStrictEqual(C.puzzleId(t, { K: 4, locks: [{ tube: 1, key: 0 }] }), base);
});

test('tall and short tubes: capacity per tube, finished means all K units', () => {
  const R = { K: 4, heights: [6, 2, 4] };
  const t = [[0, 0, 0, 1], [], [1, 1, 1]];
  assert.strictEqual(C.pourAmount(t, R, 0, 1), 1); // top run is a single unit
  const u = [[1, 0, 0, 0], [], []];
  assert.strictEqual(C.pourAmount(u, R, 0, 1), 2, 'only 2 fit in a height-2 tube');
  assert.ok(!C.isSolved([[0, 0], [0, 0], []], R), 'a color split across tubes is not finished');
  assert.ok(C.isSolved([[0, 0, 0, 0], [], [1, 1, 1, 1]], R), 'tall tube holding all 4 counts as finished');
});

test('reserved tube only takes its color', () => {
  const R = { K: 4, only: [null, null, 1] };
  const t = [[1, 0], [0, 1], []];
  assert.strictEqual(C.pourAmount(t, R, 0, 2), 0);
  assert.strictEqual(C.pourAmount(t, R, 1, 2), 1);
});

test('locked tube is sealed until its key color is finished', () => {
  const R = { K: 2, locks: [{ tube: 2, key: 0 }] };
  const t = [[0], [1, 0], [1], []];
  assert.strictEqual(C.pourAmount(t, R, 2, 3), 0, 'cannot pour out of a locked tube');
  assert.strictEqual(C.pourAmount(t, R, 1, 0), 1);
  C.pour(t, R, 1, 0); // finishes color 0
  assert.ok(!C.lockedTubes(t, R).has(2), 'lock opens');
  assert.strictEqual(C.pourAmount(t, R, 2, 1), 1);
});

test('finished tubes are corked: nothing pours out', () => {
  assert.strictEqual(C.pourAmount([[0, 0, 0, 0], []], 4, 0, 1), 0);
});

test('move limit makes the simulated player stop at the limit', () => {
  const t = [[0, 1, 0, 1], [1, 0, 1, 0], [], []];
  const par = C.solve(t, 4).moves.length;
  const tight = C.analyze(t, 4, { moveLimit: par, rng: C.mulberry32(1) });
  const loose = C.analyze(t, 4, { rng: C.mulberry32(1) });
  assert.strictEqual(tight.limit, par);
  assert.ok(tight.score >= loose.score, 'a tight limit is at least as hard');
});

test('campaign difficulty rises chapter over chapter', () => {
  const means = [];
  const chapters = Math.max(...LEVELS.map((L, i) => (L.ch != null ? L.ch : Math.floor(i / 20)))) + 1;
  for (let ch = 0; ch < chapters; ch++) {
    const s = LEVELS.filter((L, i) => (L.ch != null ? L.ch : Math.floor(i / 20)) === ch).map((l) => l.s);
    means.push(s.reduce((a, b) => a + b, 0) / s.length);
  }
  for (let i = 1; i < means.length; i++) assert.ok(means[i] > means[i - 1], `chapter ${i + 1} (${means[i].toFixed(2)}) not harder than ${i} (${means[i - 1].toFixed(2)})`);
});

console.log(`${passed} passed${process.exitCode ? ', some failed' : ''}`);
