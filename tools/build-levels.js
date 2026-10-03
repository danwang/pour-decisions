#!/usr/bin/env node
/*
 * Builds js/levels.js incrementally. Saved progress is keyed by puzzle
 * content, so shipped puzzles must never silently change:
 *
 *  - Existing levels are kept verbatim: base levels by position in the base
 *    list, inserted slots by their key (tools/campaign-plan.js).
 *  - Only slots that don't exist yet are generated, in parallel.
 *  - Every id ever shipped is listed in tools/shipped-ids.txt. The build
 *    fails if one would disappear, unless you pass --allow-remove (the id
 *    then moves to tools/retired-ids.txt).
 *
 *   node tools/build-levels.js                 add any new slots
 *   node tools/build-levels.js --rebuild-base  regenerate the 200 base levels (new campaign only)
 */
const { Worker, isMainThread, parentPort } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');
const C = require('../js/core.js');
const { RELEASE, slotsFor } = require('./campaign-plan.js');

// Exact-search budget for the chosen puzzle: makes "fewest moves" a proven minimum.
const FINAL_EXACT = 900000;
const encode = (tubes) => tubes.map((t) => t.map((c) => String.fromCharCode(97 + c)).join('')).join(',');
const colorsOf = (L) => new Set(L.t.replace(/,/g, '')).size;

function buildBase(n) {
  const spec = C.campaignSpec(n);
  const candidates = spec.kind === 'boss' || spec.kind === 'hard' ? 36 : 24;
  const lvl = C.generate(spec, C.hashString('campaign-v3-' + n), { candidates, finalExactLimit: FINAL_EXACT });
  const row = { id: C.puzzleId(lvl.tubes, lvl.cap), c: lvl.cap, t: encode(lvl.tubes), p: lvl.par, s: lvl.score, k: spec.kind };
  if (lvl.optimal) row.o = 1;
  return row;
}

function buildSlot(job) {
  const lvl = C.generate(job.spec, C.hashString('slot-' + job.key), { candidates: job.spec.kind === 'hard' ? 28 : 20, finalExactLimit: FINAL_EXACT });
  const r = typeof lvl.rules === 'number' ? null : Object.fromEntries(Object.entries(lvl.rules).filter(([k]) => k !== 'K'));
  const row = { id: C.puzzleId(lvl.tubes, lvl.rules), c: lvl.cap, t: encode(lvl.tubes), p: lvl.par, s: lvl.score, k: job.spec.kind, key: job.key };
  if (r) row.r = r;
  row.m = job.mechanics;
  if (job.intro) row.i = job.intro;
  row.n = RELEASE;
  if (lvl.optimal) row.o = 1;
  return row;
}

if (!isMainThread) {
  parentPort.on('message', (job) => parentPort.postMessage({ job, row: job.type === 'base' ? buildBase(job.n) : buildSlot(job) }));
  return;
}

const ROOT = path.join(__dirname, '..');
const LEVELS = path.join(ROOT, 'js', 'levels.js');
const SHIPPED = path.join(__dirname, 'shipped-ids.txt');
const RETIRED = path.join(__dirname, 'retired-ids.txt');
const args = new Set(process.argv.slice(2));
const readList = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : []);

const existing = fs.existsSync(LEVELS) ? require(LEVELS) : [];
const oldBase = existing.filter((l) => !l.key);
const byKey = new Map(existing.filter((l) => l.key).map((l) => [l.key, l]));
const t0 = Date.now();

async function main() {
  const jobs = [];
  const rebuildBase = args.has('--rebuild-base') || !oldBase.length;
  const base = rebuildBase ? new Array(C.TOTAL_LEVELS) : oldBase.map((l) => ({ ...l }));
  if (rebuildBase) for (let n = 1; n <= C.TOTAL_LEVELS; n++) jobs.push({ type: 'base', n });
  await run(jobs, (job, row) => { base[job.n - 1] = row; });

  // Plan the slots; generate only the ones we don't have.
  const chapters = Math.ceil(base.length / 20);
  const slotJobs = [];
  const slotRows = new Map();
  for (let ch = 0; ch < chapters; ch++) {
    for (const slot of slotsFor(ch)) {
      if (byKey.has(slot.key)) { slotRows.set(slot.key, { ...byKey.get(slot.key) }); continue; }
      const prev = base[ch * 20 + slot.after], next = base[ch * 20 + slot.after + 1] || prev;
      const adjust = slot.role === 'intro' ? -0.5 : slot.role === 'hard' ? 0.6 : 0;
      const target = (prev.s + next.s) / 2 + adjust;
      const minColors = Math.max(4, colorsOf(prev) - (slot.role === 'intro' ? 3 : 1));
      slotJobs.push({ type: 'slot', key: slot.key, mechanics: slot.mechanics, intro: slot.intro,
        spec: C.mechanicSpec(slot.mechanics, target, minColors, slot.role) });
    }
  }
  await run(slotJobs, (job, row) => slotRows.set(job.key, row));

  // Assemble: base levels in order, slots after their base position; chapter on every level.
  const levels = [];
  for (let ch = 0; ch < chapters; ch++) {
    const slots = slotsFor(ch);
    for (let i = 0; i < 20 && ch * 20 + i < base.length; i++) {
      levels.push({ ...base[ch * 20 + i], ch });
      for (const s of slots.filter((x) => x.after === i)) levels.push({ ...slotRows.get(s.key), ch });
    }
  }

  // Shipped puzzles must not disappear.
  const shipped = readList(SHIPPED);
  const now = new Set(levels.map((l) => l.id));
  const missing = shipped.filter((id) => !now.has(id));
  if (missing.length) {
    if (!args.has('--allow-remove')) {
      console.error(`refusing to remove ${missing.length} shipped puzzle(s): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
      console.error('Players have progress on these. Pass --allow-remove to retire them on purpose.');
      process.exit(1);
    }
    fs.appendFileSync(RETIRED, missing.join('\n') + '\n');
  }
  const dupes = levels.length - now.size;
  if (dupes) { console.error(`error: ${dupes} duplicate puzzle ids`); process.exit(1); }

  const out =
    '// Generated by tools/build-levels.js. Do not edit by hand: the build keeps shipped puzzles as they are.\n' +
    '// id: content id (saved progress is keyed by it), c: units per color, t: tubes bottom→top (a = palette 0),\n' +
    '// p: fewest moves (o: 1 when proven optimal), s: difficulty score, k: kind, ch: chapter (0-based)\n' +
    '// Inserted levels also have key (plan slot), r: rules (heights, only, locks, limit), m: mechanics,\n' +
    '// i: mechanic introduced here, n: release that added it.\n' +
    '(function (root) {\n  const LEVELS = [\n    ' + levels.map((r) => JSON.stringify(r)).join(',\n    ') + ',\n  ];\n' +
    "  if (typeof module === 'object' && module.exports) module.exports = LEVELS; else root.SortLevels = LEVELS;\n" +
    "})(typeof self !== 'undefined' ? self : this);\n";
  fs.writeFileSync(LEVELS, out);
  const added = levels.filter((l) => !shipped.includes(l.id)).map((l) => l.id);
  if (added.length) fs.appendFileSync(SHIPPED, added.join('\n') + '\n');
  console.error(`wrote ${levels.length} levels (${slotJobs.length} new slots, ${added.length} new ids) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

/** Run jobs across worker threads, hardest (last) first. */
function run(jobs, onDone) {
  if (!jobs.length) return Promise.resolve();
  const queue = jobs.slice().reverse();
  const threads = Math.max(1, Math.min(os.cpus().length - 1, 12, queue.length));
  let done = 0;
  return new Promise((resolve) => {
    for (let w = 0; w < threads; w++) {
      const worker = new Worker(__filename);
      const next = () => (queue.length ? worker.postMessage(queue.shift()) : worker.terminate());
      worker.on('message', ({ job, row }) => {
        onDone(job, row);
        done++;
        const what = job.type === 'base' ? `base ${String(job.n).padStart(3)}` : `${job.key.padEnd(5)} ${job.mechanics.join('+').padEnd(22)}`;
        const aim = job.spec ? ` target ${job.spec.target.toFixed(2)} (${job.spec.colors}c)` : '';
        process.stderr.write(`${what}${aim}  score ${row.s.toFixed(2)}  par ${row.p}${row.r && row.r.limit ? ` limit ${row.r.limit}` : ''}   [${done}/${jobs.length}]\n`);
        if (done === jobs.length) resolve();
        next();
      });
      next();
    }
  });
}

main();
