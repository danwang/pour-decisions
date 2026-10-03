# Tuning difficulty

How Pour Decisions measures how hard a puzzle is, and how it uses that to build a campaign that ramps smoothly, an Endless mode that adapts, and a Daily puzzle.

## What makes a sort puzzle hard

There are four levers:

| Lever | Effect |
|---|---|
| **Colors** (tube count) | More to track, longer solutions. The biggest single lever. |
| **Spare tubes** | 2 spares is the norm. With 1 spare, 70–90% of random deals are unsolvable, and the rest are brutal. The game always uses 2 and adds a one-off "+ Tube" as an assist. |
| **Tube height** | 5-slot tubes mean longer runs to untangle, and partial pours matter more. |
| **Arrangement** | Two deals with the same size can differ 3–8× in effort. Some deals are forgiving; others are full of moves that look good but lead to dead ends. |

Size sets the broad level. Arrangement is where most of the fine control lives, and you can only see it by measuring.

## Measuring a puzzle (`analyze` in `js/core.js`)

Every candidate puzzle gets three measurements.

**1. Par: the fewest moves, from A\*.** Tubes are interchangeable, so a state's key is its sorted tube list. The heuristic is `color runs − colors`. No pour ever splits a run, and a pour merges at most one run into another, so the heuristic never overestimates and A* returns the true optimum. Pruning skips moves that can't help: pouring out of a finished tube, pouring a one-color tube into an empty one, and choosing between equivalent empty tubes. Candidates are screened with a small search budget; the chosen puzzle then gets a deep exact search (900,000 positions), and the level records `o: 1` when its minimum is proven. `node tools/verify-pars.js` re-checks every level in parallel (about 8 seconds) and `--fix` corrects any stale count. If a minimum is ever unproven, the win screen says "our solver's best" rather than "the fewest possible", and congratulates a player who beats it.

An earlier build screened with the small budget only, and 4 of 240 levels stored a count that wasn't the minimum (old level 170 recorded 56; the true minimum is 50). They have been corrected; this changed only metadata, so ids and saved stars are unaffected.

**2. Effort: a simulated player.** The model player plays greedily with some noise. It likes pours onto the same color, likes finishing tubes, and dislikes spending empty tubes. When it runs out of fresh moves, it undoes and tries its next idea, like a person with an undo button. **Effort** is the average number of moves, undos included, over 16 simulated plays.

An earlier version measured the win rate of a player *without* undo. That metric saturates: above 10 colors almost nobody wins without undo, so it can't separate a hard 12-color puzzle from an easy one. Counting effort with undo keeps its resolution all the way up.

**3. Score = log2(effort).** Every +1 means twice the work, which roughly matches how difficulty feels. The UI shows it as a 1–10 rating: `rating = round(1 + (score − 2.9) × 1.15)`.

Two by-products are useful for tuning:
- **trick = effort / par** measures how misleading a position is, independent of size. A value of 1.1 means you mostly just do it; 10+ means the greedy moves are traps.
- **noUndoWin** is the share of players who win straight through, a good signal for how "fair" a puzzle feels.

## Calibration: what each size can produce

`node tools/calibrate.js 40` samples random deals at every size. Score percentiles (p10 / p50 / p90):

| Colors | 4-slot tubes | 5-slot tubes |
|---:|---|---|
| 4 | 3.52 / 3.76 / 3.98 | |
| 6 | 4.29 / 4.50 / 4.86 | 4.79 / 4.96 / 5.38 |
| 8 | 5.08 / 5.58 / 6.29 | 5.48 / 6.13 / 7.25 |
| 10 | 5.71 / 6.52 / 7.95 | 6.46 / 7.46 / 9.36 |
| 12 | 6.55 / 7.99 / 9.87 | 7.62 / 9.47 / 10.75 |
| 14 | 7.71 / 9.13 / 11.28 | |

The spread within one size widens as puzzles grow. A 12-color deal can be as easy as a typical 9-color one or harder than a typical 14-color one. That spread is why picking the right deal matters more than picking the size. The full table is `SIZE_TABLE` in `js/core.js`.

## Hitting a target

`generate(spec, seed)`:
1. **Size.** `sizeForTarget` picks the color count whose range covers the target, preferring sizes where the target sits a bit above the median. A tricky small puzzle is more satisfying than a big, bland one.
2. **Candidates.** It deals 14–36 random solvable puzzles of that size. Deals that start with a finished tube, or with more than one near-finished tube, are rejected.
3. **Pick.** It scores every candidate and keeps the one closest to the target.

Everything is seeded, so the same seed always gives the same puzzle.

## The campaign curve

```
target(L) = 3.2 + 6.1 · ((L − 1) / 199)^0.42  +  beat offset
```

- **The tutorial is separate.** Three guided mini-puzzles teach the rules before the campaign, so level 1 is already a real (gentle) puzzle and the campaign can climb fast.
- **The ramp** is steep early and flattens later. Level 20 sits around 5.5–6.7: the difficulty level 60 had before, with about 9 colors and 11 tubes. The late game ends where it did.
- **The beat** gives each block of ten a rhythm, so difficulty rises and falls instead of being a flat staircase:

  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
  |---|---|---|---|---|---|---|---|---|---|
  | −0.15 | 0 | +0.2 | **−0.9 breather** | +0.1 | +0.3 | **+0.7 hard** | **−0.8 breather** | +0.3 | **+1.2 boss** |

  The swings start at 40% size and reach full size by level 20.
- **The board grows fast.** A minimum color count (3, plus 1 every 5 levels, up to 10) keeps boards getting bigger even when a small one could hit the target. From level 5 on, 6+ colors (8+ tubes) are the norm.
- **Every other boss from level 30** uses 5-slot tubes for variety.

Result from `node tools/build-levels.js` (about 70 seconds on 12 threads):

| Chapter | Levels | Mean score | Range | Colors |
|---|---|---:|---|---|
| 1 First Drops | 1–20 | 4.85 | 3.11–6.57 | 3–9 |
| 2 Rinse Cycle | 21–40 | 6.01 | 4.75–7.31 | 7–11 |
| 3 Bench Work | 41–60 | 6.69 | 5.46–8.04 | 9–12 |
| 4 Titration | 61–80 | 7.21 | 6.09–8.44 | 9–12 |
| 5 Distillation | 81–100 | 7.65 | 6.31–9.06 | 9–12 |
| 6 Centrifuge | 101–120 | 8.05 | 6.95–9.32 | 10–13 |
| 7 Catalyst | 121–140 | 8.40 | 7.25–9.69 | 11–14 |
| 8 Chromatography | 141–160 | 8.64 | 7.44–9.99 | 11–14 |
| 9 Crystal Garden | 161–180 | 8.96 | 7.87–10.11 | 11–14 |
| 10 Grand Assay | 181–200 | 9.29 | 8.07–10.54 | 12–14 |

The median gap between a level's target and its actual score is 0.04 (90th percentile 0.17). `tools/test.js` checks that every chapter is harder on average than the one before.

Changing the curve regenerates every level, so saved progress is keyed by puzzle content, not level number (see "Saved progress" in the README).

## Mechanics

Four extra rules, all handled by the same rules engine, solver and player model. Every rules function takes either a number (classic) or `{ K, heights, only, locks, limit }`.

| Mechanic | Rule | How the solver handles it | Avg. difficulty added |
|---|---|---|---:|
| Tall and short tubes | Per-tube capacity. A tube is finished when it holds all K units of one color, so short tubes are only storage. | Capacity per tube; tubes of different kinds are no longer interchangeable, so the state key includes each tube's kind. | +0.30 |
| Reserved tube | Takes only its color. | One more check in the pour rule. | +0.26 |
| Locked tube | Sealed until a tube of the key color is finished. | Finished tubes are corked (nothing pours out), so a lock's state follows from the position; no extra search state. | +0.50 |
| Move limit | Solve within `ceil(1.25 × fewest) + 1` moves; undo gives moves back. | Par is unchanged. The simulated player treats lines longer than the limit as dead ends, so the score rises when the limit bites. | +0.62 |

The offsets come from `node tools/calibrate-mechanics.js`, which compares median scores with and without each mechanic at 6, 8 and 10 colors. The generator subtracts them from a slot's target when choosing board size (combinations are treated as additive), then picks the candidate closest to the target as usual.

The heuristic stays admissible: restrictions and locks only remove moves, and no pour splits a run.

### Where they appear

`tools/campaign-plan.js` inserts five levels per chapter from chapter 3 on (chapters 3+ have 25 levels):

- Chapter 3 introduces tall and short tubes, chapter 4 reserved tubes, chapter 5 move limits, chapter 6 locks.
- An intro level aims 0.5 easier than its neighbors; each chapter's last inserted level aims 0.6 harder and mixes mechanics.
- Later chapters combine them.

Inserted levels are aimed at the average of the two base levels around them, so the curve stays smooth.

## Endless and Daily

- **Endless → Auto** is a continuous dial from 0 to 6, mapped to `target = 3.4 + 1.15 × dial`:
  - A clean solve at or under par with no assists turns it up 0.4.
  - A solve within about 1.4× the best turns it up 0.15.
  - A hint, the extra tube, or more than one restart turns it down 0.35.
  - Skipping a puzzle turns it down 0.3.

  So it settles where you solve cleanly about half the time. The next puzzle generates in a Web Worker while you play the current one.
- **Endless → fixed tiers** (Relaxed to Expert) are named points on the same scale: 3.7, 4.6, 5.7, 6.9, 8.1, 9.3.
- **Daily** is seeded by the date and aimed at "Tricky" (6.9), so everyone gets the same puzzle each day.

## Stars and par

- **Par** is shown during play and equals ⌈1.1 × the fewest possible moves⌉. It's reachable without perfect play.
- ★★★ at par or better. ★★ within ⌈1.4 × fewest⌉ + 2. ★ for any solve.
- A hint or the extra tube each cost one star (minimum one). Undo is free, but every pour counts as a move.
- The win screen shows the true optimum ("the best possible is 34"), which gives strong players something to chase.

## How to tune it

| To change… | Edit |
|---|---|
| Overall ramp or length | `campaignTarget` (constants 3.2, 6.1, 0.42) and `TOTAL_LEVELS` |
| Rhythm within a block | `BEAT` |
| How fast boards grow | `minColors` in `campaignSpec` |
| How the player model plays | `moveAppeal`, and the temperature in `explore` |
| Size choice | `sizeForTarget`, and `SIZE_TABLE` (rerun `tools/calibrate.js`) |
| Endless adaptation | the dial steps in `win()` in `js/game.js`, and `autoTarget` |

Then run `node tools/build-levels.js && node tools/test.js`. The build only generates new slots; shipped puzzles never change (see "Adding levels without breaking saves" in the README). Changing base-curve constants affects only a `--rebuild-base`, which is for starting a new campaign.

## Next step: real player data

The score is a model of a player, not a real player. Before a real launch:

1. **Log per level:** time to solve, moves, undos, restarts, hints and quits. All of it is available in `G` at the end of `win()`.
2. **Fit the model.** Regress solve time against score. If the curve bends, adjust `rating` or the exponent in `campaignTarget`. If some levels are outliers, look at their `trick` value; the player model's preferences in `moveAppeal` may need reweighting.
3. **Watch quit rates by beat position.** If bosses cause quits, shrink the +1.2. If breathers get skipped, they're too easy.
