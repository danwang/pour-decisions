/*
 * Game controller: screens, modes, input, rules enforcement, persistence.
 * Logical state changes instantly; the Board animates to catch up.
 */
(function () {
  'use strict';

  const C = window.SortCore;
  const { Board, PALETTE } = window.SortBoard;
  const Sound = window.SortSound;
  const Haptics = window.SortHaptics;
  const LEVELS = window.SortLevels || [];
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const CHAPTERS = [
    'First Drops', 'Rinse Cycle', 'Bench Work', 'Titration', 'Distillation',
    'Centrifuge', 'Catalyst', 'Chromatography', 'Crystal Garden', 'Grand Assay',
  ];
  const PER_CHAPTER = 20;
  const FIRST_REGULAR = 6; // levels 1–5 are onboarding

  // ------------------------------------------------------------- storage --

  const KEY = 'pour-decisions-v1';
  const reducedDefault = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const defaults = () => ({
    unlocked: 1,
    stars: {},
    best: {},
    settings: { sound: true, haptics: true, symbols: false, fast: false, reduced: reducedDefault },
    endless: { auto: 1.2, choice: 'auto', solved: 0, streak: 0 },
    daily: { done: {}, streak: 0, last: '' },
    session: null,
  });
  let save = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      save = Object.assign(defaults(), d);
      save.settings = Object.assign(defaults().settings, d.settings);
      save.endless = Object.assign(defaults().endless, d.endless);
      save.daily = Object.assign(defaults().daily, d.daily);
    }
  } catch (e) { /* storage unavailable: play without saving */ }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
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
    return { ...puzzle, tubes: puzzle.tubes.map((t) => t.map((c) => map.get(c))) };
  }

  function decodeLevel(n) {
    const L = LEVELS[n - 1];
    if (!L) return null;
    return recolor({
      cap: L.c,
      tubes: L.t.split(',').map((s) => Array.from(s, (ch) => ch.charCodeAt(0) - 97)),
      par: L.p,
      score: L.s,
      kind: L.k,
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
    screen = id;
    for (const s of $$('.screen')) s.classList.toggle('active', s.id === id);
    if (id === 'game') { board.start(); requestAnimationFrame(fit); } else board.stop();
    if (id === 'home') { refreshHome(); demo.start(); } else demo.stop();
    if (id === 'levels') renderLevels();
  }

  function openSheet(id) { $('#' + id).hidden = false; Sound.tap(); }
  function closeSheet(id) { $('#' + id).hidden = true; }
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet(b.closest('.overlay').id)));
  $$('.overlay').forEach((o) => o.addEventListener('pointerdown', (e) => {
    if (e.target === o && o.id !== 'winSheet') closeSheet(o.id);
  }));
  $$('[data-back]').forEach((b) => b.addEventListener('click', () => { Sound.tap(); show('home'); }));

  // ---------------------------------------------------------------- home --

  function totalStars() { return Object.values(save.stars).reduce((a, b) => a + b, 0); }
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function refreshHome() {
    const s = save.session;
    const next = Math.min(save.unlocked, LEVELS.length);
    if (s && !s.won) {
      $('#playLabel').textContent = 'Continue';
      $('#playSub').textContent = s.mode === 'campaign' ? `Level ${s.level}` : s.mode === 'daily' ? 'Daily puzzle' : 'Endless';
    } else {
      $('#playLabel').textContent = 'Play';
      $('#playSub').textContent = `Level ${next}`;
    }
    $('#starsTotal').textContent = `${totalStars()} ★`;
    $('#endlessSub').textContent = save.endless.choice === 'auto' ? `Auto · ${C.TIERS[autoTier()].name}` : C.TIERS[+save.endless.choice].name;
    const done = !!save.daily.done[today()];
    $('#dailySub').textContent = done ? `Done · ${save.daily.streak} day${save.daily.streak === 1 ? '' : 's'}` : 'New today';
  }

  $('#playBtn').addEventListener('click', () => {
    Sound.unlock(); Sound.tap();
    const s = save.session;
    if (s && !s.won) resume(s);
    else startCampaign(Math.min(save.unlocked, LEVELS.length));
  });
  $('#levelsBtn').addEventListener('click', () => { Sound.unlock(); Sound.tap(); show('levels'); });
  $('#dailyBtn').addEventListener('click', () => { Sound.unlock(); Sound.tap(); startDaily(); });
  $('#endlessBtn').addEventListener('click', () => { Sound.unlock(); renderTiers(); openSheet('endlessSheet'); });
  $('#settingsBtn').addEventListener('click', () => { Sound.unlock(); openSheet('settingsSheet'); });
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
    const current = Math.min(save.unlocked, LEVELS.length);
    const chapters = Math.ceil(LEVELS.length / PER_CHAPTER);
    for (let ch = 0; ch < chapters; ch++) {
      const from = ch * PER_CHAPTER + 1, to = Math.min(LEVELS.length, from + PER_CHAPTER - 1);
      let got = 0;
      for (let n = from; n <= to; n++) got += save.stars[n] || 0;
      const sec = document.createElement('section');
      sec.className = 'chapter';
      const locked = from > save.unlocked;
      sec.innerHTML = `
        <div class="chapter-head">
          <div><p class="eyebrow">Chapter ${ch + 1} · ${from}–${to}</p><h3>${CHAPTERS[ch] || 'Chapter ' + (ch + 1)}</h3></div>
          ${locked ? `<button class="jump" data-jump="${from}" data-ch="${ch}">Jump here</button>` : `<span class="count">${got} / ${(to - from + 1) * 3} ★</span>`}
        </div>
        <div class="chapter-bar"><i style="width:${(100 * got) / ((to - from + 1) * 3)}%"></i></div>`;
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (let n = from; n <= to; n++) {
        const L = LEVELS[n - 1];
        const btn = document.createElement('button');
        btn.className = 'level';
        const isLocked = n > save.unlocked;
        const stars = save.stars[n] || 0;
        if (isLocked) {
          btn.classList.add('locked');
          btn.innerHTML = `<svg><use href="#i-lock"/></svg>`;
          btn.setAttribute('aria-label', `Level ${n}, locked`);
        } else {
          if (n === current && !save.stars[n]) btn.classList.add('current');
          btn.innerHTML = `<span>${n}</span><span class="mini-stars">${[1, 2, 3].map((k) => `<svg class="${k <= stars ? 'on' : ''}"><use href="#i-star"/></svg>`).join('')}</span>`;
          btn.setAttribute('aria-label', `Level ${n}, ${stars} stars`);
          btn.addEventListener('click', () => { Sound.tap(); startCampaign(n); });
        }
        if (L.k === 'boss') btn.insertAdjacentHTML('beforeend', '<svg class="crown"><use href="#i-crown"/></svg>');
        if (L.c === 5) btn.classList.add('cap5');
        grid.appendChild(btn);
      }
      sec.appendChild(grid);
      const jump = sec.querySelector('.jump');
      if (jump) jump.addEventListener('click', () => offerJump(from, ch));
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
    show('game');
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
    show('game');
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
    show('game');
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
    board.setPuzzle(G.tubes, puzzle.cap, true);
    fit();
    renderHud();
    $('#skipBtn').hidden = mode !== 'endless';
    tutorial();
    saveSession();
  }

  function resume(s) {
    const puzzle = s.puzzle;
    show('game');
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
    persist();
  }

  function fit() {
    const game = $('#game');
    const area = $('#boardArea').getBoundingClientRect();
    const g = game.getBoundingClientRect();
    if (g.width < 10) return;
    board.resize(g.width, g.height, {
      x: area.left - g.left + 16,
      y: area.top - g.top + 4,
      w: area.width - 32,
      h: area.height - 8,
    });
  }
  new ResizeObserver(() => { if (screen === 'game') fit(); if (screen === 'home') demo.fit(); }).observe($('#app'));

  // ------------------------------------------------------------------ HUD --

  function renderHud() {
    const p = G.puzzle;
    $('#hudTitle').textContent = p.title;
    const kind = $('#hudKind');
    const kinds = { boss: 'Boss', hard: 'Hard', breather: 'Breather', tutorial: 'Tutorial', daily: 'Daily' };
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
    el.textContent = G.moves;
    const par = parFor(G.puzzle.par);
    el.classList.toggle('over', G.moves > par);
    $('#hudPar').textContent = `par ${par}`;
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
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toastTimer);
    if (ms !== 0) toastTimer = setTimeout(hideToast, ms || 2600);
  }
  function hideToast() { $('#toast').hidden = true; clearTimeout(toastTimer); }

  function showLoading(on) { $('#loading').hidden = !on; }

  function caption(text) {
    const c = $('#caption');
    c.hidden = !text;
    $('#captionText').textContent = text || '';
    $('#skipTutorial').hidden = !(G.mode === 'campaign' && G.puzzle && G.puzzle.kind === 'tutorial');
  }

  /** Unlock everything up to level n and start it. Earlier levels stay playable for stars. */
  function jumpTo(n) {
    save.unlocked = Math.max(save.unlocked, n);
    if (save.session && save.session.mode === 'campaign' && save.session.level < n) save.session = null;
    persist();
    startCampaign(n);
  }
  $('#skipTutorial').addEventListener('click', () => { Sound.tap(); jumpTo(FIRST_REGULAR); });

  let jumpTarget = 0;
  function offerJump(from, ch) {
    jumpTarget = from;
    $('#jumpTitle').textContent = `Jump to Chapter ${ch + 1}?`;
    $('#jumpCopy').textContent =
      `${CHAPTERS[ch] || 'This chapter'} starts at level ${from}, around ${C.rating(LEVELS[from - 1].s)}/10 difficulty. ` +
      'Every level before it unlocks too, so you can go back for stars any time.';
    openSheet('jumpSheet');
  }
  $('#jumpGo').addEventListener('click', () => { closeSheet('jumpSheet'); jumpTo(jumpTarget); });

  // ------------------------------------------------------------ tutorial --

  function tutorial() {
    caption(null);
    if (G.mode !== 'campaign' || G.level > 2 || G.won) return;
    if (G.level === 1) {
      caption(G.selected < 0 ? 'Tap a tube to pick it up.' : 'Now tap the tube with the arrow to pour.');
    } else {
      caption('Liquid only lands on the same color or in an empty tube. Fill every tube with one color.');
    }
    const r = C.solve(G.tubes, G.puzzle.cap, { weight: 1, limit: 20000 });
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

  function tap(i) {
    if (G.won || !G.puzzle) return;
    const cap = G.puzzle.cap;
    if (G.selected < 0) {
      if (i < 0) return;
      const t = G.tubes[i];
      if (!t.length || C.isComplete(t, cap)) { board.shake(i); Sound.invalid(); Haptics.buzz(18); return; }
      select(i);
      return;
    }
    if (i < 0 || i === G.selected) { deselect(); return; }
    const n = C.pourAmount(G.tubes, cap, G.selected, i);
    if (n) { doPour(G.selected, i); return; }
    const t = G.tubes[i];
    if (t.length && !C.isComplete(t, cap)) {
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
    Sound.select(G.tubes[i].length / G.puzzle.cap);
    Haptics.buzz(6);
    if (G.mode === 'campaign' && G.level === 1) tutorial();
  }
  function deselect() {
    if (G.selected < 0) return;
    G.selected = -1;
    board.select(-1);
    Sound.deselect();
    if (G.mode === 'campaign' && G.level === 1) tutorial();
  }

  function doPour(a, b) {
    const cap = G.puzzle.cap;
    const c = C.top(G.tubes[a]);
    const n = C.pour(G.tubes, cap, a, b);
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
    if (C.isSolved(G.tubes, cap)) {
      G.won = true;
      G.elapsed += performance.now() - G.startedAt;
      caption(null);
    } else {
      G.stuck = !C.usefulMoves(G.tubes, cap).length;
      tutorial();
    }
    saveSession();
  }

  let winShown = false;
  board.onEvent = (type, d) => {
    if (type === 'pourStart') Sound.pour(d.delay, d.dur, d.fillFrom, d.fillFrom + d.n, d.cap);
    else if (type === 'complete') {
      const done = board.tubes.filter((t) => t.corked).length;
      Sound.complete(done - 1);
      Haptics.buzz([14, 50, 14]);
    } else if (type === 'idle') {
      if (G.won && $('#winSheet').hidden && !winShown) { winShown = true; setTimeout(win, 420); }
      else if (G.stuck && !G.won) {
        toast(G.extra ? 'No moves left. Undo or restart.' : 'No moves left. Undo, or add a tube.', G.history.length ? { label: 'Undo', run: undo } : null, 0);
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
      const r = await work('hint', { tubes: G.tubes, cap: G.puzzle.cap });
      if (token !== G.token) return;
      if (r.status === 'move') {
        G.hints++;
        board.setHint(r.move);
        if (G.selected >= 0 && G.selected !== r.move[0]) deselect();
        toast(`Pour the circled tube where the arrow points. ${r.left} move${r.left === 1 ? '' : 's'} from a solve.`);
      } else if (r.status === 'dead') {
        const states = [];
        const t = C.clone(G.tubes);
        for (let k = G.history.length - 1; k >= 0 && states.length < 40; k--) {
          const m = G.history[k];
          for (let j = 0; j < m.n; j++) t[m.a].push(t[m.b].pop());
          states.push(C.clone(t));
        }
        const back = states.length ? (await work('rescue', { states, cap: G.puzzle.cap })).back : 0;
        if (token !== G.token) return;
        if (back) {
          toast(`This position can’t be solved. Undo ${back} move${back === 1 ? '' : 's'} to get back on track.`,
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
    board.finishAll();
    if (!G.won) saveSession();
    show(G.mode === 'campaign' ? 'levels' : 'home');
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

  function fmtTime(ms) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function win() {
    const best = G.puzzle.par;
    const assists = (G.hints > 0 ? 1 : 0) + (G.usedExtra ? 1 : 0);
    const stars = starsFor(G.moves, best, G.mode === 'campaign' && G.level <= 2 ? 0 : assists);
    board.confetti();
    Sound.win();
    Haptics.buzz([20, 60, 20, 60, 40]);

    let title = 'Sorted!', eyebrow = G.puzzle.title, next = 'Next level', note = '';
    if (G.moves <= best) note = `Perfect. ${best} is the fewest moves possible.`;
    else if (stars === 3) note = `Under par. The best possible is ${best}.`;
    else note = `Par is ${parFor(best)}. The best possible is ${best}.`;
    if (assists && !(G.mode === 'campaign' && G.level <= 2)) note += G.hints && G.usedExtra ? ' Hint and extra tube used.' : G.hints ? ' Hint used.' : ' Extra tube used.';

    if (G.mode === 'campaign') {
      const n = G.level;
      save.stars[n] = Math.max(save.stars[n] || 0, stars);
      save.best[n] = Math.min(save.best[n] || Infinity, G.moves);
      save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, n + 1));
      if (G.puzzle.kind === 'boss') title = 'Boss cleared!';
      if (n >= LEVELS.length) { next = 'Try Endless'; }
      if (n % PER_CHAPTER === 0 && n < LEVELS.length) eyebrow = `Chapter ${n / PER_CHAPTER} complete`;
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
    persist();

    $('#winEyebrow').textContent = eyebrow;
    $('#winTitle').textContent = title;
    $('#winNote').textContent = note;
    $('#winMoves').textContent = G.moves;
    $('#winPar').textContent = parFor(best);
    $('#winTime').textContent = fmtTime(G.elapsed);
    $('#winNext').textContent = next;
    $$('#winStars .s').forEach((s, i) => { s.classList.remove('on'); void s.getBoundingClientRect(); s.classList.toggle('on', i < stars); });
    $('#winSheet').hidden = false;
  }

  $('#winNext').addEventListener('click', () => {
    Sound.tap();
    winShown = false;
    closeSheet('winSheet');
    if (G.mode === 'campaign' && G.level < LEVELS.length) startCampaign(G.level + 1);
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
    winShown = false;
    closeSheet('winSheet');
    show(G.mode === 'campaign' ? 'levels' : 'home');
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
  const settingMap = { setSound: 'sound', setHaptics: 'haptics', setSymbols: 'symbols', setFast: 'fast', setReduced: 'reduced' };
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
      b.textContent = 'Tap again to erase all progress';
      resetArmed = setTimeout(() => { b.classList.remove('armed'); b.textContent = 'Reset progress'; resetArmed = null; }, 3000);
      return;
    }
    clearTimeout(resetArmed); resetArmed = null;
    const settings = save.settings;
    save = defaults();
    save.settings = settings;
    persist();
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

  applySettings();
  show('home');
  // Test handle for local development only.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.PourDebug = { G, board, tap, begin: (...a) => begin(...a), startCampaign, startEndless, startDaily, save: () => save };
})();
