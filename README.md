# Pour Decisions

A color-sort puzzle for phones and desktop: pour liquid between test tubes until each holds one color. It has 200 generated campaign levels, adaptive Endless, a Daily puzzle, and no dependencies or build step.

```bash
node tools/serve.js        # then open http://localhost:8173
```

Opening `index.html` straight from disk also works, but then generation and hints run on the main thread, because browsers block Web Workers on `file://`.

## Rules

- Tap a tube to pick it up, then tap another to pour. Dragging from one to the other also works.
- Liquid pours only onto the same color or into an empty tube.
- The whole top color pours at once, as much as fits.
- A tube is finished when it's full of one color.

## Features

- **Tutorial.** Three guided mini-puzzles, offered on first launch and skippable, and replayable from How to play.
- **Campaign.** 200 levels in 10 chapters that ramp quickly (8+ tubes by the end of chapter 1), each block of ten paced as warm-up, climb, breather, hard, breather, boss. Every level is open from the start; Play picks up after your furthest solve.
- **Endless.** Puzzles generated on demand, with an Auto mode that adjusts difficulty to how you play, or six fixed tiers.
- **Daily.** One seeded puzzle per day, with a streak.
- **Assists.** Unlimited undo, restart, hints from the solver, and one extra tube per level. When a position can no longer be solved, the hint says so and offers to undo exactly back to the last solvable position.
- **Feel.**
  - Tubes tilt around their lip, and the liquid stays level: each color band is a horizontal slice of the rotated tube, solved by area.
  - The tilt angle is solved so the liquid sits right at the lip while pouring.
  - A stream, splashes, surface wobble, and a cork with sparkles when a tube is finished.
- **Responsiveness.**
  - Input fires on pointer-down.
  - The game state updates instantly and the board catches up. You can queue moves as fast as you tap: unrelated pours run in parallel, and the animation speeds up when you get ahead.
  - Tap targets span the whole column, at least 44px wide, with nearest-tube fallback.
- **Sound.** All synthesized with WebAudio. The pour's glugs rise in pitch as the receiving tube fills.
- **Accessibility.** Color-blind shape symbols, reduced motion (pours in place), quick pours, keyboard shortcuts (`1`–`9`, `Z`, `R`, `H`), and colors that avoid similar hues in small puzzles.
- **Resume.** An unfinished puzzle survives closing the tab.

## Layout

```
index.html        markup and icons
style.css         design tokens and screens
js/core.js        rules, A* solver, player model, difficulty analysis, generator
                  (UMD: runs in the page, a Web Worker, and Node)
js/levels.js      the generated campaign (each level carries a content id)
js/migrations.js  saved-data schema version and upgrade steps
js/board.js       canvas renderer and animation system
js/audio.js       synthesized sound and haptics
js/game.js        controller: modes, input, hints, saving, menus
js/worker.js      background generation and hint search
tools/
  calibrate.js    difficulty spread by puzzle size
  build-levels.js regenerate js/levels.js (parallel)
  test.js         rules, solver optimality, dead-end proof, every level solvable
  serve.js        no-cache local server
```

## Saved progress

Progress lives in `localStorage` under `pour-decisions-v1`, with a schema version `v` inside.

- **Keyed by content, not position.** Stars and best moves are stored per puzzle id (`SortCore.puzzleId`): a hash of the tube height and tubes, with tube order and color labels normalized. Rebuilding, reordering or replacing levels can't pass one puzzle's stars to another; a puzzle that moves keeps its stars.
- **Next up** is the level after your furthest solve, computed from current levels, so it stays right after any reshuffle.
- **An unfinished puzzle** is found again by id. If it no longer exists, the saved session is dropped.
- **Changing the format:** bump `SCHEMA` in `js/migrations.js` and add an upgrade step; old saves pass through every step in order. The v1 → v2 step converts level-number progress using a snapshot of the v1 level ids.

See [DIFFICULTY.md](DIFFICULTY.md) for how difficulty is measured and tuned.
