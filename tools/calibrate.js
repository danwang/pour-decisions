#!/usr/bin/env node
/*
 * Samples random puzzles at each size and reports how the difficulty
 * measures are distributed. Use it to tune campaignSpec, TIERS and rating().
 *
 *   node tools/calibrate.js            # default sweep
 *   node tools/calibrate.js 40         # 40 samples per size
 */
const C = require('../js/core.js');

const samples = +process.argv[2] || 24;
const sizes = [];
for (let c = 3; c <= 14; c++) sizes.push({ colors: c, cap: 4, empties: 2 });
for (let c = 5; c <= 12; c++) sizes.push({ colors: c, cap: 5, empties: 2 });
sizes.push({ colors: 5, cap: 4, empties: 1 }, { colors: 7, cap: 4, empties: 1 });
const table = {};

const q = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};
const f = (x, d = 2) => x.toFixed(d).padStart(6);

console.log('size        solv%   par(p50)  opt%   noUndoWin(p10/p50/p90)  trick(p10/p50/p90)     score(p10/p50/p90)     ms/puzzle');
for (const size of sizes) {
  const rng = C.mulberry32(C.hashString(JSON.stringify(size)));
  const res = [];
  let unsolvable = 0;
  const t0 = Date.now();
  for (let i = 0; i < samples; i++) {
    const tubes = C.randomPuzzle(rng, size);
    const a = C.analyze(tubes, size.cap, { rng: C.mulberry32(i + 1) });
    if (!a) { unsolvable++; continue; }
    res.push(a);
  }
  const ms = (Date.now() - t0) / samples;
  const label = `${size.colors}c/${size.cap}h/${size.empties}e`.padEnd(11);
  if (!res.length) { console.log(label, 'all unsolvable'); continue; }
  const succ = res.map((r) => r.success), tr = res.map((r) => r.trick), sc = res.map((r) => r.score), par = res.map((r) => r.par);
  const opt = res.filter((r) => r.optimal).length / res.length;
  console.log(
    label,
    f(100 * res.length / samples, 0) + '%',
    f(q(par, 0.5), 0) + '   ',
    f(100 * opt, 0) + '%',
    ' ', f(q(succ, 0.1)), f(q(succ, 0.5)), f(q(succ, 0.9)),
    '  ', f(q(tr, 0.1)), f(q(tr, 0.5)), f(q(tr, 0.9)),
    '  ', f(q(sc, 0.1)), f(q(sc, 0.5)), f(q(sc, 0.9)),
    '  ', f(ms, 0),
  );
  if (size.empties === 2) {
    (table[size.cap] = table[size.cap] || {})[size.colors] = [q(sc, 0.1), q(sc, 0.5), q(sc, 0.9)].map((x) => +x.toFixed(2));
  }
}
console.log('\nSIZE_TABLE (paste into js/core.js):');
console.log(JSON.stringify(table));
