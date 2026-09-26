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

- **Campaign.** 200 levels in 10 chapters, each block of ten paced as warm-up, climb, breather, hard, breather, boss. Stars and progress are saved.
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
js/levels.js      the generated campaign
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

See [DIFFICULTY.md](DIFFICULTY.md) for how difficulty is measured and tuned.
