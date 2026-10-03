#!/usr/bin/env node
/*
 * Checks every level's recorded "fewest moves" (p) with a deep exact A*
 * search, in parallel. A level is "proven" when exact A* finishes within
 * the budget; then p must equal the optimum.
 *
 *   node tools/verify-pars.js            report
 *   node tools/verify-pars.js --fix      also correct p and mark proven levels (o: 1)
 *
 * Fixing p only changes metadata, never puzzle content, so ids and saved
 * progress are unaffected.
 */
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');
const C = require('../js/core.js');

const decode = (L) => L.t.split(',').map((s) => Array.from(s, (ch) => ch.charCodeAt(0) - 97));
const rulesOf = (L) => (L.r ? { K: L.c, ...L.r } : L.c);
const BUDGET = 900000;

if (!isMainThread) {
  parentPort.on('message', ({ i, L }) => {
    const r = C.solve(decode(L), rulesOf(L), { weight: 1, limit: workerData.budget });
    parentPort.postMessage({ i, best: r.solved ? r.moves.length : null, expanded: r.expanded });
  });
  return;
}

const LEVELS_PATH = path.join(__dirname, '..', 'js', 'levels.js');
const LEVELS = require(LEVELS_PATH);
const fix = process.argv.includes('--fix');
const threads = Math.max(1, Math.min(6, os.cpus().length - 1));
const queue = LEVELS.map((L, i) => ({ i, L })).sort((a, b) => b.L.s - a.L.s); // hardest first
const results = new Array(LEVELS.length);
let done = 0;
const t0 = Date.now();

for (let w = 0; w < threads; w++) {
  const worker = new Worker(__filename, { workerData: { budget: BUDGET }, resourceLimits: { maxOldGenerationSizeMb: 3500 } });
  const next = () => (queue.length ? worker.postMessage(queue.shift()) : worker.terminate());
  worker.on('message', (r) => {
    results[r.i] = r;
    if (++done === LEVELS.length) finish();
    next();
  });
  worker.on('error', (e) => { console.error('worker error', e.message); });
  next();
}

function finish() {
  let wrong = 0, unproven = 0;
  const rows = [];
  LEVELS.forEach((L, i) => {
    const r = results[i];
    if (r.best == null) { unproven++; rows.push(`  level ${i + 1}: not proven within budget (recorded ${L.p})`); return; }
    if (r.best !== L.p) { wrong++; rows.push(`  level ${i + 1}: recorded ${L.p}, optimal ${r.best}${L.key ? ' (new)' : ''}`); }
  });
  console.log(`${LEVELS.length} levels checked in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${LEVELS.length - wrong - unproven} correct, ${wrong} wrong, ${unproven} unproven`);
  console.log(rows.join('\n'));
  if (!fix) return;
  const src = fs.readFileSync(LEVELS_PATH, 'utf8');
  let out = src;
  LEVELS.forEach((L, i) => {
    const r = results[i];
    const before = JSON.stringify(L);
    const next = { ...L };
    if (r.best != null) { next.p = r.best; next.o = 1; } else delete next.o;
    const after = JSON.stringify(next);
    if (before !== after) out = out.replace(before, after);
  });
  fs.writeFileSync(LEVELS_PATH, out);
  console.log('levels.js updated (p corrected, o: 1 on proven levels)');
}
