# Pour Decisions

A color-sort puzzle for phones and desktop: pour liquid between test tubes until each holds one color. It has 200 generated campaign levels, adaptive Endless, a Daily puzzle, and no dependencies or build step. Optional sign-in syncs progress through Supabase.

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
- **Campaign.** 240 levels in 10 chapters that ramp quickly (8+ tubes by the end of chapter 1), each block of ten paced as warm-up, climb, breather, hard, breather, boss. Every level is open from the start; Play picks up after your furthest solve.
- **Mechanics.** From chapter 3, new rules arrive one at a time, each with an intro level, then mix: tall and short tubes (chapter 3), tubes reserved for one color (4), move limits (5) and locked tubes that open when a color is finished (6). Returning players see "New" badges and a one-time card pointing at the first new level.
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
- **Sync.** Optional sign-in by email (one message carries both a link and a code) keeps progress on every device. The local save stays the source of truth, so the game never waits on the network; each sync merges the account's copy in without losing a solve. Settings stay per device.

## Layout

```
index.html        markup and icons
style.css         design tokens and screens
js/core.js        rules, A* solver, player model, difficulty analysis, generator
                  (UMD: runs in the page, a Web Worker, and Node)
js/levels.js      the generated campaign (each level carries a content id); append-only
js/migrations.js  saved-data schema version, upgrade steps, and merging two devices' saves
js/cloud-config.js Supabase URL and public key (empty turns sign-in off)
js/cloud.js       sign-in and sync; loads the Supabase client from the CDN on demand
js/board.js       canvas renderer and animation system
js/audio.js       synthesized sound and haptics
js/fakeads.js     parody interstitial ad engine (standalone, reusable)
js/fakeads-creatives.js  the parody ads themselves
ads.html          test bench: cycle through every ad
js/game.js        controller: modes, input, hints, saving, menus
js/worker.js      background generation and hint search
supabase/schema.sql  the saves table and its row-level security
tools/
  calibrate.js    difficulty spread by puzzle size
  build-levels.js add new plan slots to js/levels.js (parallel); never changes shipped puzzles
  campaign-plan.js where inserted levels go and which mechanics they use
  calibrate-mechanics.js how much each mechanic adds to difficulty
  shipped-ids.txt every puzzle id ever shipped (the build refuses to drop one)
  test.js         rules, solver optimality, dead-end proof, every level solvable
  serve.js        no-cache local server
  stamp-version.js write js/version.js at deploy time
  build-site.js   build the deployable site into dist/ (Cloudflare)
```

## Parody ads

After each solved puzzle (not the tutorial), a fake full-screen ad plays with a 5-second countdown before its X appears. Every brand is made up and nothing is fetched or tracked. Turn them off in Settings → Ads.

`js/fakeads.js` has no dependencies and injects its own CSS, so it can be dropped into another page:

```js
const ads = FakeAds.create({ countdown: 5 });
await ads.show();                       // resolves when closed
FakeAds.register({ id, brand, tagline, render(stage, api) { … } });
```

Open `/ads.html` to cycle through every ad with a picker, arrow keys and a countdown selector.

## Build stamp

The home screen shows which commit is running, for example "build 6f74d50 · Sep 28, 14:02", linked to the commit on GitHub. The deploy build stamps `js/version.js` from the host's commit variable (Render's `RENDER_GIT_COMMIT`, Cloudflare's `CF_PAGES_COMMIT_SHA` or `WORKERS_CI_COMMIT_SHA`), falling back to `git rev-parse HEAD`. The committed `js/version.js` is a placeholder that shows "dev". `tools/serve.js` answers with the live local commit, marked "+local" when there are uncommitted changes.

## Deploying

- **Cloudflare** (Workers or Pages): `node tools/test.js && node tools/build-site.js` builds `dist/`, which holds only what the site serves, with the version stamped and a `_headers` file for caching. For Workers, set that as the build command and `npx wrangler deploy` as the deploy command (`wrangler.jsonc` points at `dist/`); for Pages, set the output directory to `dist`.
- **Render**: `render.yaml` stamps `js/version.js` in place and publishes the repo root.

Sign-in links only return to addresses listed in Supabase under Authentication → URL Configuration, so add each new site address there.

## Adding levels without breaking saves

Saved progress is keyed by puzzle content, so the campaign is append-only:

1. Add slots to `tools/campaign-plan.js`. A slot has a permanent key (like `c7s3`), a position between base levels, and its mechanics.
2. Run `node tools/build-levels.js`. Existing levels are copied through unchanged; only new slots are generated, aimed at the difficulty of their neighbors.
3. The build records new ids in `tools/shipped-ids.txt` and fails if a shipped puzzle would disappear (`--allow-remove` retires one on purpose). `tools/test.js` checks the same.
4. Bump `RELEASE` in the plan when shipping a batch, so returning players get "New" badges for it.

Level numbers can shift when slots are inserted; stars follow the puzzle, not the number.

## Saved progress

Progress lives in `localStorage` under `pour-decisions-v1`, with a schema version `v` inside.

- **Keyed by content, not position.** Stars and best moves are stored per puzzle id (`SortCore.puzzleId`): a hash of the tube height and tubes, with tube order and color labels normalized. Rebuilding, reordering or replacing levels can't pass one puzzle's stars to another; a puzzle that moves keeps its stars.
- **Next up** is the level after your furthest solve, computed from current levels, so it stays right after any reshuffle.
- **An unfinished puzzle** is found again by id. If it no longer exists, the saved session is dropped.
- **Rules are part of the id.** A move limit, tube heights, reserved tubes or locks make a different puzzle. Classic puzzles hash exactly as before (pinned in the tests).
- **Additive state needs no migration.** New keys get defaults on load (for example `newSince`/`newsSeen` for the "New" badges, which default differently for returning players).
- **Changing the format:** bump `SCHEMA` in `js/migrations.js` and add an upgrade step; old saves pass through every step in order. The v1 → v2 step converts level-number progress using a snapshot of the v1 level ids.

See [DIFFICULTY.md](DIFFICULTY.md) for how difficulty is measured and tuned.
