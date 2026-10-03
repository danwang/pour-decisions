/*
 * Game controller: screens, modes, input, rules enforcement, persistence.
 * Logical state changes instantly; the Board animates to catch up.
 */
(function () {
  'use strict';

  const C = window.SortCore;
  const { Board, PALETTE, COLOR_NAMES } = window.SortBoard;
  const Sound = window.SortSound;
  const Haptics = window.SortHaptics;
  const LEVELS = window.SortLevels || [];
  const Cloud = window.PourCloud;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const CHAPTERS = [
    'First Drops', 'Rinse Cycle', 'Bench Work', 'Titration', 'Distillation',
    'Centrifuge', 'Catalyst', 'Chromatography', 'Crystal Garden', 'Grand Assay',
  ];
  // Release number of the newest levels (inserted levels carry `n`); drives "New" badges.
  const CURRENT_RELEASE = Math.max(1, ...LEVELS.map((L) => L.n || 1));
  const chapterOf = (n) => (LEVELS[n - 1] && LEVELS[n - 1].ch != null ? LEVELS[n - 1].ch : Math.floor((n - 1) / 20));

  const MECHANIC_NAMES = { heights: 'tall and short tubes', only: 'reserved tubes', locks: 'locked tubes', limit: 'move limits' };
  const INTRO_TEXT = {
    heights: 'New: tubes come in different heights. A tube is finished when it holds all 4 of one color, so short tubes are only for storage.',
    only: 'New: a tube with a colored rim only takes that color.',
    limit: 'New: this level has a move limit. Undo gives moves back.',
    locks: 'New: a locked tube opens once a tube of its lock’s color is finished.',
  };

  // ------------------------------------------------------------- storage --

  const KEY = 'pour-decisions-v1';
  const reducedDefault = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const defaults = () => ({
    v: window.SortSave.SCHEMA,
    progress: {}, // puzzle content id → { stars, best }
    tutorialDone: false,
    settings: { sound: false, haptics: true, symbols: false, fast: false, reduced: reducedDefault, ads: true },
    endless: { auto: 1.2, choice: 'auto', solved: 0, streak: 0 },
    daily: { done: {}, streak: 0, last: '' },
    session: null,
  });
  let save = defaults();
  // Additive keys. New players have seen everything; returning players get "New" badges.
  save.newSince = CURRENT_RELEASE;
  save.newsSeen = CURRENT_RELEASE;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = window.SortSave.migrate(JSON.parse(raw), C);
      if (d.newSince == null) d.newSince = 1;
      if (d.newsSeen == null) d.newsSeen = 1;
      save = Object.assign(defaults(), d);
      save.settings = Object.assign(defaults().settings, d.settings);
      save.endless = Object.assign(defaults().endless, d.endless);
      save.daily = Object.assign(defaults().daily, d.daily);
    }
  } catch (e) { /* storage unavailable: play without saving */ }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
    Cloud.changed();
  }

  // -------------------------------------------------------------- worker --

  // Two workers so a hint never waits behind puzzle generation.
  const makeWorker = () => {
    let worker = null, seq = 0;
    const pending = new Map();
    const runInline = (type, payload) => new Promise((res, rej) => {
      setTimeout(() => { try { res(C.tasks[type](payload)); } catch (e) { rej(e); } }, 30);
    });
    try {
      worker = new Worker('js/worker.js');
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.result);
      };
      worker.onerror = () => {
        worker = null;
        for (const [, p] of pending) runInline(p.type, p.payload).then(p.res, p.rej);
        pending.clear();
      };
    } catch (e) { worker = null; }
    return (type, payload) => {
      if (!worker) return runInline(type, payload);
      return new Promise((res, rej) => {
        const id = ++seq;
        pending.set(id, { res, rej, type, payload });
        worker.postMessage({ id, type, payload });
      });
    };
  };
  const genWork = makeWorker();
  const hintWork = makeWorker();
  const work = (type, payload) => (type === 'generate' ? genWork : hintWork)(type, payload);

  // ---------------------------------------------------------------- state --

  const G = {
    mode: 'campaign',
    level: 1,
    puzzle: null, // { cap, tubes, par, score, kind, title }
    tubes: [],
    history: [],
    moves: 0,
    undos: 0,
    hints: 0,
    extra: false,
    usedExtra: false,
    restarts: 0,
    startedAt: 0,
    elapsed: 0,
    won: false,
    selected: -1,
    token: 0,
    stuck: false,
  };

  const board = new Board($('#board'), {});

  // Pairs that are too close to share a small puzzle.
  const CONFUSABLE = [[0, 10], [0, 9], [0, 1], [1, 2], [1, 11], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [10, 11], [12, 13], [8, 10]];
  const clash = (a, b) => CONFUSABLE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

  /**
   * Recolor a puzzle so its colors are as far apart as possible: pick
   * mutually distinct hues first, and only reuse near neighbors when a
   * puzzle needs more colors than that.
   */
  function recolor(puzzle, seed) {
    const rng = C.mulberry32(seed);
    const used = [...new Set(puzzle.tubes.flat())];
    const order = C.shuffle([...Array(PALETTE.length).keys()], rng);
    const chosen = [];
    for (const c of order) if (chosen.length < used.length && !chosen.some((d) => clash(c, d))) chosen.push(c);
    for (const c of order) if (chosen.length < used.length && !chosen.includes(c)) chosen.push(c);
    const map = new Map(used.map((c, i) => [c, chosen[i]]));
    const out = { ...puzzle, tubes: puzzle.tubes.map((t) => t.map((c) => map.get(c))) };
    const r = puzzle.rules;
    if (r && typeof r === 'object') {
      out.rules = { ...r };
      if (r.only) out.rules.only = r.only.map((c) => (c == null ? null : map.get(c)));
      if (r.locks) out.rules.locks = r.locks.map((l) => ({ tube: l.tube, key: map.get(l.key) }));
    }
    return out;
  }

  /** Rules for the current puzzle: a number for classic puzzles, else { K, heights, only, locks, limit }. */
  const rulesOf = (p) => (p.rules != null ? p.rules : p.cap);
  const limitOf = (p) => (p.rules && typeof p.rules === 'object' && p.rules.limit) || 0;
  const colorName = (c) => COLOR_NAMES[c] || 'that color';

  // Progress is keyed by puzzle content, so levels can be reordered or replaced safely.
  const levelById = new Map(LEVELS.map((L, i) => [L.id, i + 1]));
  const progressOf = (n) => (LEVELS[n - 1] && save.progress[LEVELS[n - 1].id]) || {};
  const starsOf = (n) => progressOf(n).stars || 0;
  /** The level after the furthest one solved. */
  function nextUp() {
    let furthest = 0;
    for (let n = 1; n <= LEVELS.length; n++) if (starsOf(n)) furthest = n;
    return Math.min(furthest + 1, LEVELS.length);
  }

  function decodeLevel(n) {
    const L = LEVELS[n - 1];
    if (!L) return null;
    return recolor({
      id: L.id,
      cap: L.c,
      rules: L.r ? { K: L.c, ...L.r } : L.c,
      tubes: L.t.split(',').map((s) => Array.from(s, (ch) => ch.charCodeAt(0) - 97)),
      par: L.p,
      proven: !!L.o,
      score: L.s,
      kind: L.k,
      intro: L.i || null,
      mechanics: L.m || [],
    }, n * 7919);
  }

  /** Three stars at par (10% above the solver's best), two a bit over, one for any solve. */
  const parFor = (best) => Math.ceil(best * 1.1);
  function starsFor(moves, best, assists) {
    let s = moves <= parFor(best) ? 3 : moves <= Math.ceil(best * 1.4) + 2 ? 2 : 1;
    return Math.max(1, s - assists);
  }

  // -------------------------------------------------------------- screens --

  let screen = 'home';
  function show(id) {
    if (screen === 'game' && id !== 'game') {
      // Leaving a puzzle: settle animations and keep it resumable.
      board.finishAll();
      if (G.puzzle && !G.won) saveSession();
      $('#winSheet').hidden = true;
      winShown = false;
    }
    screen = id;
    for (const s of $$('.screen')) s.classList.toggle('active', s.id === id);
    if (id === 'game') { board.start(); requestAnimationFrame(fit); } else board.stop();
    if (id === 'home') { refreshHome(); demo.start(); } else demo.stop();
    if (id === 'levels') renderLevels();
  }

  // ------------------------------------------------------------- history --
  //
  // Screens and sheets are history entries, so the browser's back button
  // (and Android's back gesture) works like the in-app back buttons.
  // Entries carry a depth so in-app back never leaves the page: at depth 0
  // it swaps in the fallback screen instead.

  const nav = {
    state: () => history.state || { screen: 'home', depth: 0 },
    /** Go to a screen. From an open sheet, the sheet's entry is replaced. */
    go(id) {
      const st = nav.state();
      if (st.sheet) {
        hideSheets();
        history.replaceState({ screen: id, depth: st.depth }, '');
      } else if (st.screen !== id) {
        history.pushState({ screen: id, depth: st.depth + 1 }, '');
      }
      show(id);
    },
    /** Step back to wherever the player came from. */
    back(fallback) {
      const st = nav.state();
      if (st.depth > 0) { history.back(); return; }
      history.replaceState({ screen: fallback, depth: 0 }, '');
      hideSheets();
      show(fallback);
    },
  };

  function hideSheets() { for (const o of $$('.overlay')) o.hidden = true; }

  window.addEventListener('popstate', (e) => {
    const st = e.state || { screen: 'home', depth: 0 };
    let id = st.screen;
    if (id === 'game' && !G.puzzle) id = 'home'; // stale entry from before a reload
    for (const o of $$('.overlay')) o.hidden = o.id !== st.sheet;
    if (id !== screen) show(id);
  });

  function openSheet(id) {
    $('#' + id).hidden = false;
    Sound.tap();
    const st = nav.state();
    history.pushState({ screen: st.screen, sheet: id, depth: st.depth + 1 }, '');
  }
  /** Close a sheet without touching history (it is being replaced or was never pushed). */
  function closeSheet(id) { $('#' + id).hidden = true; }
  /** The player dismissed a sheet: same as pressing back. */
  function dismissSheet(id) {
    if (nav.state().sheet === id) history.back();
    else closeSheet(id);
  }
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => dismissSheet(b.closest('.overlay').id)));
  $$('.overlay').forEach((o) => o.addEventListener('pointerdown', (e) => {
    if (e.target === o && o.id !== 'winSheet') dismissSheet(o.id);
  }));
  $$('[data-back]').forEach((b) => b.addEventListener('click', () => { Sound.tap(); nav.back('home'); }));

  // ---------------------------------------------------------------- home --

  function totalStars() { let t = 0; for (let n = 1; n <= LEVELS.length; n++) t += starsOf(n); return t; }

  /** The saved unfinished puzzle, if it still exists. A campaign puzzle is found by id, wherever it now sits. */
  function liveSession() {
    const s = save.session;
    if (!s || s.won) return null;
    if (s.mode === 'campaign') {
      const n = s.puzzle && levelById.get(s.puzzle.id);
      if (!n) return null;
      s.level = n;
      s.puzzle.title = `Level ${n}`;
    }
    return s;
  }
  const needsTutorial = () => !save.tutorialDone && !Object.keys(save.progress).length;
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function refreshHome() {
    const s = liveSession();
    if (s) {
      $('#playLabel').textContent = 'Continue';
      $('#playSub').textContent = { campaign: `Level ${s.level}`, daily: 'Daily puzzle', tutorial: 'Tutorial' }[s.mode] || 'Endless';
    } else {
      $('#playLabel').textContent = 'Play';
      $('#playSub').textContent = needsTutorial() ? 'Quick tutorial' : `Level ${nextUp()}`;
    }
    $('#starsTotal').textContent = `${totalStars()} ★`;
    $('#endlessSub').textContent = save.endless.choice === 'auto' ? `Auto · ${C.TIERS[autoTier()].name}` : C.TIERS[+save.endless.choice].name;
    const done = !!save.daily.done[today()];
    $('#dailySub').textContent = done ? `Done · ${save.daily.streak} day${save.daily.streak === 1 ? '' : 's'}` : 'New today';
    renderNews();
  }

  /**
   * One-time card for returning players when an update added levels behind
   * their progress: points at the first new mechanic's intro level.
   */
  function renderNews() {
    const card = $('#newsCard');
    card.hidden = true;
    if (save.newsSeen >= CURRENT_RELEASE) return;
    const next = nextUp();
    const fresh = LEVELS.map((L, i) => ({ L, n: i + 1 })).filter(({ L }) => (L.n || 1) > save.newsSeen);
    const behind = fresh.filter(({ n }) => n < next);
    if (!behind.length) { save.newsSeen = CURRENT_RELEASE; persist(); return; }
    const intro = behind.find(({ L }) => L.i) || behind[0];
    const names = [...new Set(behind.flatMap(({ L }) => L.m || []))].map((m) => MECHANIC_NAMES[m]).filter(Boolean);
    $('#newsText').textContent = `${behind.length} new levels with ${names.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`;
    $('#newsGo').textContent = `Try level ${intro.n}`;
    $('#newsGo').onclick = () => { Sound.tap(); save.newsSeen = CURRENT_RELEASE; persist(); startCampaign(intro.n); };
    card.hidden = false;
  }
  $('#newsClose').addEventListener('click', () => { save.newsSeen = CURRENT_RELEASE; persist(); $('#newsCard').hidden = true; });

  $('#playBtn').addEventListener('click', () => {
    Sound.unlock(); Sound.tap();
    const s = liveSession();
    if (s) resume(s);
    else if (needsTutorial()) startTutorial(0);
    else startCampaign(nextUp());
  });
  $('#levelsBtn').addEventListener('click', () => { Sound.unlock(); Sound.tap(); nav.go('levels'); });
  $('#dailyBtn').addEventListener('click', () => { Sound.unlock(); Sound.tap(); startDaily(); });
  $('#endlessBtn').addEventListener('click', () => { Sound.unlock(); renderTiers(); openSheet('endlessSheet'); });
  $('#settingsBtn').addEventListener('click', () => { Sound.unlock(); openSheet('settingsSheet'); });
  $('#accountBtn').addEventListener('click', () => { Sound.unlock(); openSheet('accountSheet'); });
  $('#helpBtn').addEventListener('click', () => { Sound.unlock(); openSheet('helpSheet'); });

  // Home demo: a small puzzle that solves itself on a loop.
  const demo = (() => {
    const canvas = $('#demo');
    const b = new Board(canvas, { speed: 0.9 });
    b.opts.symbols = save.settings.symbols;
    let timer = null, seed = 7, moves = [], i = 0;
    function fitDemo() {
      const r = canvas.parentElement.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      b.resize(r.width, r.height, { x: 12, y: 8, w: r.width - 24, h: r.height - 16 });
    }
    function load() {
      const rng = C.mulberry32(seed++);
      const pal = C.shuffle([...Array(PALETTE.length).keys()], rng).slice(0, 4);
      const tubes = C.randomPuzzle(rng, { colors: 4, cap: 4, empties: 2, palette: pal });
      const sol = C.solve(tubes, 4, { weight: 1, limit: 40000 });
      if (!sol.solved) return load();
      b.setPuzzle(tubes, 4, true);
      fitDemo();
      moves = sol.moves; i = 0;
      b.work = C.clone(tubes);
    }
    function tick() {
      if (i < moves.length) {
        const [x, y] = moves[i++];
        const c = C.top(b.work[x]);
        const n = C.pour(b.work, 4, x, y);
        b.select(x);
        timer = setTimeout(() => { b.pour(x, y, c, n); timer = setTimeout(tick, 820); }, 260);
      } else {
        timer = setTimeout(() => { load(); timer = setTimeout(tick, 900); }, 2200);
      }
    }
    return {
      start() {
        if (reduceMotion()) { canvas.parentElement.style.visibility = 'hidden'; return; }
        canvas.parentElement.style.visibility = '';
        if (!moves.length) load(); else fitDemo();
        b.start();
        clearTimeout(timer);
        timer = setTimeout(tick, 700);
      },
      stop() { clearTimeout(timer); b.stop(); },
      fit: fitDemo,
      board: b,
    };
  })();

  // -------------------------------------------------------------- levels --

  function renderLevels() {
    const wrap = $('#levelsScroll');
    const frag = document.createDocumentFragment();
    const current = nextUp();
    const chapters = chapterOf(LEVELS.length) + 1;
    for (let ch = 0; ch < chapters; ch++) {
      let from = 0, to = 0;
      for (let n = 1; n <= LEVELS.length; n++) if (chapterOf(n) === ch) { if (!from) from = n; to = n; }
      if (!from) continue;
      let got = 0;
      for (let n = from; n <= to; n++) got += starsOf(n);
      const sec = document.createElement('section');
      sec.className = 'chapter';
      sec.innerHTML = `
        <div class="chapter-head">
          <div><p class="eyebrow">Chapter ${ch + 1} · ${from}–${to}</p><h3>${CHAPTERS[ch] || 'Chapter ' + (ch + 1)}</h3></div>
          <span class="count">${got} / ${(to - from + 1) * 3} ★</span>
        </div>
        <div class="chapter-bar"><i style="width:${(100 * got) / ((to - from + 1) * 3)}%"></i></div>`;
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (let n = from; n <= to; n++) {
        const L = LEVELS[n - 1];
        const btn = document.createElement('button');
        btn.className = 'level';
        // Every level is open; ones past your progress are just quieter.
        const stars = starsOf(n);
        if (n === current && !stars) btn.classList.add('current');
        else if (n > current && !stars) btn.classList.add('ahead');
        btn.innerHTML = `<span>${n}</span><span class="mini-stars">${[1, 2, 3].map((k) => `<svg class="${k <= stars ? 'on' : ''}"><use href="#i-star"/></svg>`).join('')}</span>`;
        btn.setAttribute('aria-label', `Level ${n}, ${stars} stars${n === current && !stars ? ', next up' : ''}`);
        btn.addEventListener('click', () => { Sound.tap(); startCampaign(n); });
        if (L.k === 'boss') btn.insertAdjacentHTML('beforeend', '<svg class="crown"><use href="#i-crown"/></svg>');
        if (L.c === 5) btn.classList.add('cap5');
        if ((L.n || 1) > save.newSince && !stars) btn.insertAdjacentHTML('beforeend', '<b class="new-badge">New</b>');
        if (L.m && L.m.length) btn.classList.add('mech');
        grid.appendChild(btn);
      }
      sec.appendChild(grid);
      frag.appendChild(sec);
    }
    wrap.replaceChildren(frag);
    $('#levelsStars').textContent = `${totalStars()} / ${LEVELS.length * 3} ★`;
    const cur = wrap.querySelector('.level.current');
    if (cur) requestAnimationFrame(() => cur.scrollIntoView({ block: 'center' }));
  }

  // ------------------------------------------------------------- endless --

  const autoTier = () => Math.max(0, Math.min(C.TIERS.length - 1, Math.floor(save.endless.auto)));
  function renderTiers() {
    const box = $('#tiers');
    const opts = [{ id: 'auto', name: 'Auto', note: `Adapts to you · now ${C.TIERS[autoTier()].name}, ${C.rating(C.autoTarget(save.endless.auto))}/10` }]
      .concat(C.TIERS.map((t, i) => ({ id: String(i), name: t.name, note: `Difficulty ${C.rating(t.target)}/10` })));
    box.innerHTML = opts.map((o) => `<button class="tier" role="radio" aria-checked="${save.endless.choice === o.id}" data-tier="${o.id}"><b>${o.name}</b><small>${o.note}</small></button>`).join('');
    box.querySelectorAll('.tier').forEach((b) => b.addEventListener('click', () => {
      save.endless.choice = b.dataset.tier; persist(); Sound.tap(); renderTiers();
      prefetch.clear();
    }));
    $('#endlessSolved').textContent = save.endless.solved;
    $('#endlessStreak').textContent = save.endless.streak;
    $('#endlessAuto').textContent = C.TIERS[autoTier()].name;
  }
  $('#endlessStart').addEventListener('click', () => { closeSheet('endlessSheet'); startEndless(); });

  /** Where Endless is aimed: Auto's continuous dial, or a fixed tier. */
  function endlessAim() {
    if (save.endless.choice === 'auto') return { target: C.autoTarget(save.endless.auto), name: C.TIERS[autoTier()].name };
    const t = C.TIERS[+save.endless.choice] || C.TIERS[1];
    return { target: t.target, name: t.name };
  }

  /** Keeps the next endless puzzle generating in the background. */
  const prefetch = (() => {
    let slot = null;
    function request(target) {
      const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
      const spec = C.specForTarget(target, C.mulberry32(seed), 'endless');
      slot = { target, promise: work('generate', { spec, seed }).then((p) => ({ ...p, kind: 'endless' })) };
      slot.promise.catch(() => { slot = null; });
      return slot.promise;
    }
    const close = (a, b) => Math.abs(a - b) < 0.3;
    return {
      take(target) {
        const s = slot && close(slot.target, target) ? slot.promise : request(target);
        slot = null;
        return s;
      },
      warm(target) { if (!slot || !close(slot.target, target)) request(target); },
      clear() { slot = null; },
    };
  })();

  async function startEndless() {
    Sound.unlock();
    const aim = endlessAim();
    showLoading(true);
    nav.go('game');
    try {
      const p = await prefetch.take(aim.target);
      showLoading(false);
      begin('endless', 0, recolor({ ...p, title: `Endless · ${aim.name}` }, (Math.random() * 1e9) >>> 0));
      prefetch.warm(endlessAim().target);
    } catch (e) {
      showLoading(false);
      toast('Could not mix a puzzle. Try again.');
    }
  }

  // --------------------------------------------------------------- daily --

  async function startDaily() {
    const day = today();
    const seed = C.hashString('daily-' + day);
    const spec = C.specForTarget(C.TIERS[3].target, C.mulberry32(seed), 'daily');
    showLoading(true);
    nav.go('game');
    try {
      const p = await work('generate', { spec, seed, candidates: 18 });
      showLoading(false);
      const d = new Date();
      const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      begin('daily', 0, recolor({ ...p, kind: 'daily', title: `Daily · ${label}`, day }, seed));
    } catch (e) {
      showLoading(false);
      toast('Could not load today’s puzzle.');
    }
  }

  // ------------------------------------------------------------ campaign --

  function startCampaign(n) {
    const p = decodeLevel(n);
    if (!p) return;
    begin('campaign', n, { ...p, title: `Level ${n}` });
    nav.go('game');
  }

  // ---------------------------------------------------------- game setup --

  function begin(mode, level, puzzle, restore) {
    G.mode = mode;
    G.level = level;
    G.puzzle = puzzle;
    G.tubes = C.clone(puzzle.tubes);
    G.history = [];
    G.moves = 0; G.undos = 0; G.hints = 0; G.restarts = 0;
    G.extra = false; G.usedExtra = false;
    G.won = false; G.stuck = false;
    G.selected = -1;
    G.token++;
    G.elapsed = 0;
    winShown = false;
    G.startedAt = performance.now();
    if (restore) {
      G.tubes = restore.tubes;
      G.history = restore.history;
      G.moves = restore.moves; G.undos = restore.undos; G.hints = restore.hints;
      G.extra = restore.extra; G.usedExtra = restore.usedExtra; G.restarts = restore.restarts;
      G.elapsed = restore.elapsed || 0;
    }
    closeSheet('winSheet');
    hideToast();
    board.setPuzzle(G.tubes, rulesOf(puzzle), true);
    fit();
    renderHud();
    $('#skipBtn').hidden = mode !== 'endless';
    tutorial();
    saveSession();
  }

  function resume(s) {
    const puzzle = s.puzzle;
    nav.go('game');
    begin(s.mode, s.level, puzzle, s);
    if (s.mode === 'endless') prefetch.warm(endlessAim().target);
  }

  function saveSession() {
    save.session = {
      mode: G.mode, level: G.level, puzzle: G.puzzle,
      tubes: G.tubes, history: G.history,
      moves: G.moves, undos: G.undos, hints: G.hints, extra: G.extra, usedExtra: G.usedExtra,
      restarts: G.restarts, elapsed: G.elapsed + (performance.now() - G.startedAt), won: G.won,
    };
    save.sessionAt = Date.now();
    persist();
  }

  /** Size the board to the space between HUD and toolbar, leaving room for a caption. `smooth` slides tubes. */
  function fit(smooth) {
    const game = $('#game');
    const area = $('#boardArea').getBoundingClientRect();
    const g = game.getBoundingClientRect();
    if (g.width < 10) return;
    const cap = $('#caption');
    const covered = cap.hidden ? 0 : Math.max(0, area.bottom - cap.getBoundingClientRect().top + 10);
    const region = {
      x: area.left - g.left + 16,
      y: area.top - g.top + 4,
      w: area.width - 32,
      h: area.height - 8 - covered,
    };
    if (smooth && board.cssW === g.width && board.cssH === g.height) { board.region = region; board.layout(false); }
    else board.resize(g.width, g.height, region);
  }
  new ResizeObserver(() => { if (screen === 'game') fit(); if (screen === 'home') demo.fit(); }).observe($('#app'));

  // ------------------------------------------------------------------ HUD --

  function renderHud() {
    const p = G.puzzle;
    $('#hudTitle').textContent = p.title;
    const kind = $('#hudKind');
    const kinds = { boss: 'Boss', hard: 'Hard', breather: 'Breather', tutorial: 'Tutorial', daily: 'Daily', intro: 'New rule' };
    const k = kinds[p.kind];
    kind.hidden = !k;
    kind.textContent = k || '';
    kind.className = 'chip ' + (p.kind || '');
    const r = C.rating(p.score || 3);
    const meter = $('#hudMeter');
    meter.innerHTML = Array.from({ length: 10 }, (_, i) => {
      const hue = 170 - i * 17;
      return `<i class="${i < r ? 'on' : ''}" style="--c:hsl(${hue} 80% 60%)"></i>`;
    }).join('');
    meter.setAttribute('aria-label', `Difficulty ${r} of 10`);
    updateMoves(false);
    const tubeLeft = G.extra ? 0 : 1;
    $('#tubeBadge').textContent = tubeLeft;
    $('#tubeBadge').hidden = !tubeLeft;
    $('#tubeBtn').disabled = !tubeLeft;
    $('#undoBtn').disabled = !G.history.length;
  }

  function updateMoves(bump) {
    const el = $('#hudMoves');
    const limit = limitOf(G.puzzle);
    if (limit) {
      // Move-limited: show what's left. Undo gives moves back.
      const left = limit - G.history.length;
      el.textContent = left;
      el.classList.toggle('over', left <= 3);
      $('#hudPar').textContent = left === 1 ? 'move left' : 'moves left';
    } else {
      el.textContent = G.moves;
      const par = parFor(G.puzzle.par);
      el.classList.toggle('over', G.moves > par);
      $('#hudPar').textContent = `par ${par}`;
    }
    if (bump) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    $('#undoBtn').disabled = !G.history.length;
  }

  let toastTimer = null;
  function toast(text, action, ms) {
    const t = $('#toast');
    $('#toastText').textContent = text;
    const btn = $('#toastAct');
    if (action) {
      btn.hidden = false;
      btn.textContent = action.label;
      btn.onclick = () => { hideToast(); action.run(); };
    } else btn.hidden = true;
    t.hidden = false;
    // Sit above a caption when one is showing.
    const cap = $('#caption');
    t.style.bottom = cap.hidden ? '' : `${$('#game').getBoundingClientRect().bottom - cap.getBoundingClientRect().top + 8}px`;
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer);
    if (ms !== 0) toastTimer = setTimeout(hideToast, ms || 2600);
  }
  function hideToast() { $('#toast').hidden = true; clearTimeout(toastTimer); }

  function showLoading(on) { $('#loading').hidden = !on; }

  function caption(text) {
    const c = $('#caption');
    const was = c.hidden;
    c.hidden = !text;
    $('#captionText').textContent = text || '';
    $('#skipTutorial').hidden = G.mode !== 'tutorial';
    // The board makes room for a caption (and takes it back), sliding the tubes.
    if (was !== c.hidden && screen === 'game') requestAnimationFrame(() => fit(true));
  }

  function finishTutorial() {
    save.tutorialDone = true;
    persist();
  }
  $('#helpTutorial').addEventListener('click', () => { closeSheet('helpSheet'); startTutorial(0); });
  $('#skipTutorial').addEventListener('click', () => { Sound.tap(); finishTutorial(); startCampaign(nextUp()); });

  // ------------------------------------------------------------ tutorial --

  /**
   * A short guided tutorial, separate from the campaign. Each step teaches
   * one idea; the first two point at every move, the last lets go.
   */
  const TUTORIAL = [
    { tubes: [[0, 0, 1, 1], [1, 1, 0, 0], []], guided: true },
    { tubes: [[0, 1, 1], [1, 0, 0], [0, 1], []], guided: true,
      text: 'Liquid only pours onto the same color, or into an empty tube.' },
    { tubes: [[0, 1, 2, 0], [2, 0, 1, 1], [1, 2, 0, 2], [], []], guided: false,
      text: 'Your turn: make every tube one color. Empty tubes are scratch space.' },
  ];

  function startTutorial(step) {
    const T = TUTORIAL[step];
    const par = C.solve(T.tubes, 4).moves.length;
    const puzzle = recolor({ cap: 4, tubes: T.tubes, par, score: 2.5, kind: 'tutorial', title: `Tutorial ${step + 1} of ${TUTORIAL.length}` }, 101 + step);
    begin('tutorial', step, puzzle);
    nav.go('game');
  }

  function tutorial() {
    caption(null);
    // A level that introduces a mechanic explains it until the first pour.
    if (G.mode === 'campaign' && G.puzzle.intro && !G.history.length && !G.won) { caption(INTRO_TEXT[G.puzzle.intro]); return; }
    if (G.mode !== 'tutorial' || G.won) return;
    const T = TUTORIAL[G.level];
    if (G.level === 0) caption(G.selected < 0 ? 'Tap a tube to pick it up.' : 'Now tap the tube with the arrow to pour.');
    else caption(T.text);
    if (!T.guided) return;
    const r = C.solve(G.tubes, rulesOf(G.puzzle), { weight: 1, limit: 20000 });
    if (r.solved && r.moves.length) board.setHint(r.moves[0]);
  }

  // --------------------------------------------------------------- input --

  let downTube = -1, downSel = -1;
  const canvas = $('#board');
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    Sound.unlock();
    const p = localPoint(e);
    const i = board.hitTest(p.x, p.y);
    downSel = G.selected;
    downTube = i;
    tap(i);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  canvas.addEventListener('pointerup', (e) => {
    const p = localPoint(e);
    const i = board.hitTest(p.x, p.y);
    // Drag-to-pour: pressed on a tube, released over another.
    if (downTube >= 0 && i >= 0 && i !== downTube && G.selected === downTube && downSel !== downTube) tap(i);
    downTube = -1;
  });
  function localPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function nope(i, message) {
    board.shake(i);
    Sound.invalid();
    Haptics.buzz(18);
    if (message) toast(message, null, 1800);
  }
  const lockMessage = (i) => `Locked until a ${colorName(C.norm(rulesOf(G.puzzle)).lockKey.get(i))} tube is finished.`;
  const outOfMoves = () => { const L = limitOf(G.puzzle); return L && G.history.length >= L; };

  function tap(i) {
    if (G.won || !G.puzzle) return;
    const rules = rulesOf(G.puzzle);
    const locked = C.lockedTubes(G.tubes, rules);
    if (G.selected < 0) {
      if (i < 0) return;
      const t = G.tubes[i];
      if (locked && locked.has(i)) { nope(i, lockMessage(i)); return; }
      if (!t.length || C.isComplete(t, rules)) { nope(i); return; }
      if (outOfMoves()) { nope(i); showOutOfMoves(); return; }
      select(i);
      return;
    }
    if (i < 0 || i === G.selected) { deselect(); return; }
    const n = C.pourAmount(G.tubes, rules, G.selected, i);
    if (n) { doPour(G.selected, i); return; }
    const t = G.tubes[i];
    if (locked && locked.has(i)) { nope(i, lockMessage(i)); deselect(); return; }
    const only = C.norm(rules).only(i);
    if (only >= 0 && t.length < C.norm(rules).h(i) && (!t.length || C.top(t) === C.top(G.tubes[G.selected]))) {
      nope(i, `This tube only takes ${colorName(only)}.`);
      deselect();
      return;
    }
    if (t.length && !C.isComplete(t, rules)) {
      // Not a legal pour, but it is a tube you could pick up: switch to it.
      select(i);
    } else {
      board.shake(i);
      Sound.invalid();
      Haptics.buzz(18);
      deselect();
    }
  }

  function select(i) {
    G.selected = i;
    board.select(i);
    Sound.select(G.tubes[i].length / C.norm(rulesOf(G.puzzle)).h(i));
    Haptics.buzz(6);
    if (G.mode === 'tutorial' && G.level === 0) tutorial();
  }
  function deselect() {
    if (G.selected < 0) return;
    G.selected = -1;
    board.select(-1);
    Sound.deselect();
    if (G.mode === 'tutorial' && G.level === 0) tutorial();
  }

  function doPour(a, b) {
    const rules = rulesOf(G.puzzle);
    const c = C.top(G.tubes[a]);
    const n = C.pour(G.tubes, rules, a, b);
    G.history.push({ a, b, n, c });
    G.moves++;
    G.selected = -1;
    G.token++;
    board.select(-1);
    board.setHint(null);
    board.pour(a, b, c, n);
    Haptics.buzz(10);
    hideToast();
    updateMoves(true);
    if (C.isSolved(G.tubes, rules)) {
      G.won = true;
      G.elapsed += performance.now() - G.startedAt;
      caption(null);
    } else {
      G.stuck = !C.usefulMoves(G.tubes, rules).length || outOfMoves();
      tutorial();
    }
    saveSession();
  }

  function showOutOfMoves() {
    toast('Out of moves. Undo to get some back, or restart.', G.history.length ? { label: 'Undo', run: undo } : { label: 'Restart', run: restart }, 0);
  }

  let winShown = false;
  board.onEvent = (type, d) => {
    if (type === 'pourStart') Sound.pour(d.delay, d.dur, d.fillFrom, d.fillFrom + d.n, d.cap);
    else if (type === 'complete') {
      const done = board.tubes.filter((t) => t.corked).length;
      Sound.complete(done - 1);
      Haptics.buzz([14, 50, 14]);
    } else if (type === 'unlock') {
      Sound.complete(4);
      Haptics.buzz([10, 30, 10]);
    } else if (type === 'idle') {
      if (G.won && $('#winSheet').hidden && !winShown) {
        winShown = true;
        if (G.mode === 'tutorial' && G.level < TUTORIAL.length - 1) {
          caption('Nice!');
          const step = G.level + 1, token = G.token;
          setTimeout(() => { if (G.token === token && screen === 'game') startTutorial(step); }, 900);
        } else setTimeout(win, 420);
      }
      else if (G.stuck && !G.won) {
        if (outOfMoves()) showOutOfMoves();
        else toast(G.extra ? 'No moves left. Undo or restart.' : 'No moves left. Undo, or add a tube.', G.history.length ? { label: 'Undo', run: undo } : null, 0);
      }
    }
  };

  // ------------------------------------------------------------- actions --

  function undo() {
    if (G.won || !G.history.length) return;
    const m = G.history.pop();
    for (let k = 0; k < m.n; k++) G.tubes[m.a].push(G.tubes[m.b].pop());
    G.undos++;
    G.token++;
    G.stuck = false;
    if (G.selected >= 0) { G.selected = -1; board.select(-1); }
    board.setHint(null);
    board.undo(m.b, m.a, m.c, m.n);
    Sound.undo();
    Haptics.buzz(8);
    hideToast();
    updateMoves(false);
    tutorial();
    saveSession();
  }

  function restart() {
    if (!G.puzzle) return;
    G.restarts++;
    const keep = { restarts: G.restarts, hints: G.hints, usedExtra: G.usedExtra };
    const hints = G.hints;
    begin(G.mode, G.level, G.puzzle);
    Object.assign(G, keep);
    G.hints = hints;
    Sound.undo();
    saveSession();
  }

  function addTube() {
    if (G.won || G.extra) return;
    G.extra = true;
    G.usedExtra = true;
    G.tubes.push([]);
    G.stuck = false;
    G.token++;
    board.finishAll();
    board.addTube();
    Sound.select(0);
    hideToast();
    renderHud();
    saveSession();
  }

  let hintBusy = false;
  async function hint() {
    if (G.won || hintBusy) return;
    const token = G.token;
    hintBusy = true;
    $('#hintBtn').classList.add('busy');
    try {
      const rules = C.rulesSpec(rulesOf(G.puzzle));
      const limit = limitOf(G.puzzle);
      const remaining = limit ? limit - G.history.length : undefined;
      const r = await work('hint', { tubes: G.tubes, cap: rules, remaining });
      if (token !== G.token) return;
      if (r.status === 'move') {
        G.hints++;
        board.setHint(r.move);
        if (G.selected >= 0 && G.selected !== r.move[0]) deselect();
        toast(`Pour the circled tube where the arrow points. ${r.left} move${r.left === 1 ? '' : 's'} from a solve.`);
      } else if (r.status === 'dead' || r.status === 'over') {
        const states = [];
        const t = C.clone(G.tubes);
        for (let k = G.history.length - 1; k >= 0 && states.length < 40; k--) {
          const m = G.history[k];
          for (let j = 0; j < m.n; j++) t[m.a].push(t[m.b].pop());
          states.push(C.clone(t));
        }
        // Under a move limit, undoing k moves leaves (remaining + k) moves to finish.
        const rem = limit ? states.map((_, k) => remaining + k + 1) : undefined;
        const back = states.length ? (await work('rescue', { states, cap: rules, remaining: rem })).back : 0;
        if (token !== G.token) return;
        const why = r.status === 'over' ? 'This can’t be finished within the move limit.' : 'This position can’t be solved.';
        if (back) {
          toast(`${why} Undo ${back} move${back === 1 ? '' : 's'} to get back on track.`,
            { label: `Undo ${back}`, run: () => { for (let k = 0; k < back; k++) undo(); } }, 0);
        } else toast('This one needs a fresh start.', { label: 'Restart', run: restart }, 0);
      } else {
        toast('No hint found from here. Try undoing a few moves.');
      }
    } catch (e) {
      toast('Hint failed. Try again.');
    } finally {
      hintBusy = false;
      $('#hintBtn').classList.remove('busy');
    }
  }

  $('#undoBtn').addEventListener('click', undo);
  $('#restartBtn').addEventListener('click', restart);
  $('#hintBtn').addEventListener('click', hint);
  $('#tubeBtn').addEventListener('click', addTube);
  $('#skipBtn').addEventListener('click', () => {
    if (!G.won) { save.endless.auto = Math.max(0, save.endless.auto - 0.3); save.endless.streak = 0; persist(); }
    startEndless();
  });
  $('#gameBack').addEventListener('click', () => {
    Sound.tap();
    nav.back(G.mode === 'campaign' ? 'levels' : 'home');
  });

  document.addEventListener('keydown', (e) => {
    if (screen !== 'game' || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (!$('#winSheet').hidden) {
      if (k === 'enter' || k === ' ') { e.preventDefault(); $('#winNext').click(); }
      return;
    }
    if (/^[0-9]$/.test(k)) { const i = k === '0' ? 9 : +k - 1; if (i < G.tubes.length) tap(i); }
    else if (k === 'z' || k === 'backspace') undo();
    else if (k === 'r') restart();
    else if (k === 'h') hint();
    else if (k === 'escape') deselect();
  });

  // ------------------------------------------------------------------ win --

  // Parody interstitials (js/fakeads.js). Shown once per solved puzzle, never in the tutorial.
  const ads = window.FakeAds ? window.FakeAds.create({ countdown: 5, earlyClose: true }) : null;
  function afterAd(then) {
    if (!ads || !save.settings.ads || G.mode === 'tutorial') { then(); return; }
    // Let the confetti land before the ad barges in, like the real thing.
    setTimeout(() => {
      if (screen !== 'game' || !G.won) { then(); return; }
      ads.show({ reducedMotion: !!save.settings.reduced }).then(then);
    }, 1100);
  }

  function fmtTime(ms) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function win() {
    const best = G.puzzle.par;
    const assists = (G.hints > 0 ? 1 : 0) + (G.usedExtra ? 1 : 0);
    // Under a move limit undo refunds moves, so what counts is the moves in the final solution.
    const counted = limitOf(G.puzzle) ? G.history.length : G.moves;
    const stars = G.mode === 'tutorial' ? 3 : starsFor(counted, best, assists);
    board.confetti();
    Sound.win();
    Haptics.buzz([20, 60, 20, 60, 40]);

    let title = 'Sorted!', eyebrow = G.puzzle.title, next = 'Next level', note = '';
    // Only claim a minimum the solver proved. Otherwise it's the best it found.
    const proven = G.puzzle.proven || G.puzzle.optimal;
    const bestLabel = proven ? `The fewest possible is ${best}.` : `Our solver’s best is ${best}.`;
    if (counted < best && !proven && !G.usedExtra) note = `You beat our solver! Its best was ${best}.`;
    else if (counted <= best) note = proven ? `Perfect. ${best} is the fewest moves possible.` : `Perfect. ${best} matches our solver’s best.`;
    else if (stars === 3) note = `Under par. ${bestLabel}`;
    else note = `Par is ${parFor(best)}. ${bestLabel}`;
    if (assists && G.mode !== 'tutorial') note += G.hints && G.usedExtra ? ' Hint and extra tube used.' : G.hints ? ' Hint used.' : ' Extra tube used.';

    if (G.mode === 'tutorial') {
      finishTutorial();
      eyebrow = 'Tutorial complete';
      title = 'You’re ready!';
      note = 'Levels ramp up quickly. Undo is free, and hints are there when you need one.';
      next = `Start level ${nextUp()}`;
    } else if (G.mode === 'campaign') {
      const n = G.level;
      const rec = save.progress[G.puzzle.id] || (save.progress[G.puzzle.id] = {});
      rec.stars = Math.max(rec.stars || 0, stars);
      rec.best = Math.min(rec.best || Infinity, counted);
      if (G.puzzle.kind === 'boss') title = 'Boss cleared!';
      if (n >= LEVELS.length) { next = 'Try Endless'; }
      if (n < LEVELS.length && chapterOf(n + 1) !== chapterOf(n)) eyebrow = `Chapter ${chapterOf(n) + 1} complete`;
    } else if (G.mode === 'endless') {
      const E = save.endless;
      E.solved++;
      E.streak++;
      // Adaptive difficulty: clean, efficient solves turn the dial up; assists turn it down.
      if (!assists && !G.restarts && G.moves <= parFor(best)) E.auto += 0.4;
      else if (!assists && G.moves <= Math.ceil(best * 1.4) + 2) E.auto += 0.15;
      else if (assists || G.restarts > 1) E.auto -= 0.35;
      E.auto = Math.max(0, Math.min(C.TIERS.length - 0.01, E.auto));
      next = 'Next puzzle';
      prefetch.warm(endlessAim().target);
    } else if (G.mode === 'daily') {
      const D = save.daily;
      const day = G.puzzle.day || today();
      if (!D.done[day]) {
        const y = new Date(); y.setDate(y.getDate() - 1);
        const yKey = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
        D.streak = D.last === yKey ? D.streak + 1 : 1;
        D.last = day;
      }
      D.done[day] = Math.max(D.done[day] || 0, stars);
      title = 'Daily done!';
      note += ` Streak: ${D.streak} day${D.streak === 1 ? '' : 's'}.`;
      next = 'Play Endless';
    }
    save.session = null;
    save.sessionAt = Date.now();
    persist();

    $('#winEyebrow').textContent = eyebrow;
    $('#winTitle').textContent = title;
    $('#winNote').textContent = note;
    $('#winMoves').textContent = counted;
    $('#winPar').textContent = parFor(best);
    $('#winTime').textContent = fmtTime(G.elapsed);
    $('#winNext').textContent = next;
    $$('#winStars .s').forEach((s, i) => { s.classList.remove('on'); void s.getBoundingClientRect(); s.classList.toggle('on', i < stars); });
    afterAd(() => { if (screen === 'game' && G.won) $('#winSheet').hidden = false; });
  }

  $('#winNext').addEventListener('click', () => {
    Sound.tap();
    winShown = false;
    closeSheet('winSheet');
    if (G.mode === 'tutorial') startCampaign(nextUp());
    else if (G.mode === 'campaign' && G.level < LEVELS.length) startCampaign(G.level + 1);
    else startEndless();
  });
  $('#winReplay').addEventListener('click', () => {
    Sound.tap();
    winShown = false;
    closeSheet('winSheet');
    begin(G.mode, G.level, G.puzzle);
  });
  $('#winMenu').addEventListener('click', () => {
    Sound.tap();
    nav.back(G.mode === 'campaign' ? 'levels' : 'home');
  });

  // ------------------------------------------------------------- settings --

  function reduceMotion() { return !!save.settings.reduced; }
  function applySettings() {
    const s = save.settings;
    Sound.setEnabled(s.sound);
    Haptics.enabled = s.haptics;
    board.opts.symbols = s.symbols;
    board.opts.reducedMotion = s.reduced;
    board.opts.speed = s.fast ? 1.6 : 1;
    demo.board.opts.symbols = s.symbols;
  }
  const settingMap = { setSound: 'sound', setHaptics: 'haptics', setSymbols: 'symbols', setFast: 'fast', setReduced: 'reduced', setAds: 'ads' };
  for (const [id, key] of Object.entries(settingMap)) {
    const el = $('#' + id);
    el.checked = !!save.settings[key];
    el.addEventListener('change', () => {
      save.settings[key] = el.checked;
      persist();
      applySettings();
      if (key === 'sound' && el.checked) { Sound.unlock(); Sound.tap(); }
      if (key === 'haptics' && el.checked) Haptics.buzz(15);
      if (key === 'reduced' && screen === 'home') demo.start();
    });
  }
  let resetArmed = null;
  $('#resetBtn').addEventListener('click', () => {
    const b = $('#resetBtn');
    if (!resetArmed) {
      b.classList.add('armed');
      b.textContent = Cloud.user ? 'Tap again to erase progress on every device' : 'Tap again to erase all progress';
      resetArmed = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Reset progress'; resetArmed = null; }, 3000);
      return;
    }
    clearTimeout(resetArmed); resetArmed = null;
    const settings = save.settings;
    save = defaults();
    save.settings = settings;
    if (Cloud.user) {
      // Signed in: the account is reset too, and other devices drop their old copy when they next sync.
      save.resetAt = Date.now();
      save.syncedAs = Cloud.user.id;
      persist();
      Cloud.sync({ replace: true });
    } else persist();
    b.classList.remove('armed');
    b.textContent = 'Progress erased';
    setTimeout(() => { b.textContent = 'Reset progress'; }, 1800);
    refreshHome();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (screen === 'game' && !G.won) saveSession();
      board.stop(); demo.stop();
    } else if (screen === 'game') board.start();
    else if (screen === 'home') demo.start();
  });

  // Which build is this? Stamped at deploy time by tools/stamp-version.js.
  (function showBuild() {
    const v = window.PourVersion || { sha: 'dev' };
    const sha = String(v.sha || 'dev');
    const short = /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : sha;
    const when = v.builtAt ? ' · ' + new Date(v.builtAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const label = `build ${short}${v.local ? '+local' : ''}${when}`;
    const box = $('#buildInfo');
    box.textContent = '';
    if (short !== sha.slice(0, 7) || v.local) box.textContent = label;
    else {
      const a = document.createElement('a');
      a.href = `https://github.com/danwang/pour-decisions/commit/${sha}`;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = label;
      box.appendChild(a);
    }
    box.title = sha;
  })();

  applySettings();
  history.replaceState({ screen: 'home', depth: 0 }, '');
  show('home');

  // Sign-in and sync (js/cloud.js). A merged save from the account replaces ours wholesale.
  Cloud.init({
    get: () => save,
    set(next) {
      save = next;
      try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
      if (screen === 'home') refreshHome();
      else if (screen === 'levels') renderLevels();
    },
    open: () => openSheet('accountSheet'),
  });

  // Test handle for local development only.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.PourDebug = { G, board, tap, begin: (...a) => begin(...a), startCampaign, startEndless, startDaily, ads, save: () => save };
})();
