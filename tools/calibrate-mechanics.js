#!/usr/bin/env node
/*
 * How much does each mechanic add to difficulty? Samples random deals with
 * and without it at a few sizes and reports the median score shift. The
 * result feeds MECHANIC_OFFSET in js/core.js.
 *
 *   node tools/calibrate-mechanics.js [samples=16]
 */
const C = require('../js/core.js');

const samples = +process.argv[2] || 16;
const variants = {
  heights: { heights: 'mixed' },
  only: { empties: 1, only: 1 },
  locks: { locks: 1 },
  limit: { limit: true },
};
const sizes = [6, 8, 10];

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function scores(spec, seedBase) {
  const rng = C.mulberry32(C.hashString(seedBase));
  const out = [];
  for (let i = 0; i < samples * 3 && out.length < samples; i++) {
    const deal = C.randomDeal(rng, spec);
    const a = C.analyze(deal.tubes, deal.rules, {
      rng: C.mulberry32(i + 1),
      moveLimit: spec.limit ? C.moveLimitFor : undefined,
    });
    if (a) out.push(a.score);
  }
  return out;
}

const result = {};
console.log('mechanic  colors  base p50  with p50  shift   solvable');
for (const [name, extra] of Object.entries(variants)) {
  const shifts = [];
  for (const colors of sizes) {
    const base = { colors, cap: 4, empties: 2 };
    const b = scores(base, `base-${colors}`);
    const m = scores({ ...base, ...extra }, `${name}-${colors}`);
    const shift = median(m) - median(b);
    shifts.push(shift);
    console.log(`${name.padEnd(9)} ${String(colors).padStart(4)}   ${median(b).toFixed(2).padStart(7)}  ${median(m).toFixed(2).padStart(8)}  ${shift >= 0 ? '+' : ''}${shift.toFixed(2)}   ${m.length}/${samples}`);
  }
  result[name] = +(shifts.reduce((a, b) => a + b, 0) / shifts.length).toFixed(2);
}
console.log('\nMECHANIC_OFFSET (paste into js/core.js):');
console.log(JSON.stringify(result));
