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
test(`all ${LEVELS.length} levels are well-formed and solvable in par`, () => {
  LEVELS.forEach((L, i) => {
    const tubes = decode(L);
    const counts = {};
    for (const t of tubes) { assert.ok(t.length <= L.c, `level ${i + 1}: overfull tube`); for (const c of t) counts[c] = (counts[c] || 0) + 1; }
    for (const c in counts) assert.strictEqual(counts[c], L.c, `level ${i + 1}: color ${c} has ${counts[c]} units`);
    const r = C.solve(tubes, L.c, { weight: 3, limit: 200000 });
    assert.ok(r.solved, `level ${i + 1} unsolvable`);
    // Replay the solution through the rules to be sure it is legal.
    const t = C.clone(tubes);
    for (const [a, b] of r.moves) assert.ok(C.pour(t, L.c, a, b) > 0, `level ${i + 1}: illegal move`);
    assert.ok(C.isSolved(t, L.c));
    assert.ok(r.moves.length >= L.p, `level ${i + 1}: found ${r.moves.length} < recorded best ${L.p}`);
  });
});

test('level ids are unique and match their content', () => {
  const seen = new Set();
  LEVELS.forEach((L, i) => {
    assert.ok(L.id, `level ${i + 1}: missing id`);
    assert.strictEqual(L.id, C.puzzleId(decode(L), L.c), `level ${i + 1}: id does not match content`);
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

test('campaign difficulty rises chapter over chapter', () => {
  const means = [];
  for (let ch = 0; ch < LEVELS.length / 20; ch++) {
    const s = LEVELS.slice(ch * 20, ch * 20 + 20).map((l) => l.s);
    means.push(s.reduce((a, b) => a + b, 0) / s.length);
  }
  for (let i = 1; i < means.length; i++) assert.ok(means[i] > means[i - 1], `chapter ${i + 1} (${means[i].toFixed(2)}) not harder than ${i} (${means[i - 1].toFixed(2)})`);
});

console.log(`${passed} passed${process.exitCode ? ', some failed' : ''}`);
