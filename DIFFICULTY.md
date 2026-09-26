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

**1. Par: the fewest moves, from A\*.** Tubes are interchangeable, so a state's key is its sorted tube list. The heuristic is `color runs − colors`. No pour ever splits a run, and a pour merges at most one run into another, so the heuristic never overestimates and A* returns the true optimum. Pruning skips moves that can't help: pouring out of a finished tube, pouring a one-color tube into an empty one, and choosing between equivalent empty tubes. All 200 shipped levels have a verified optimal par; the slowest takes 0.7s to prove.

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
target(L) = 2.9 + 6.4 · (L / 200)^0.75  +  beat offset
```

- **The ramp** rises quickly early, when every new idea is fresh, and eases off later, when each step costs more to design and to play.
- **The beat** gives each block of ten a rhythm, so difficulty rises and falls instead of being a flat staircase:

  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
  |---|---|---|---|---|---|---|---|---|---|
  | −0.15 | 0 | +0.2 | **−0.9 breather** | +0.1 | +0.3 | **+0.7 hard** | **−0.8 breather** | +0.3 | **+1.2 boss** |

  The swings start at half size and grow to full by level 60, so early players don't hit a wall.
- **The board grows** with a minimum color count (4 plus 1 every 22 levels), so later levels look bigger even when a small board could hit the target.
- **Every other boss after level 50** uses 5-slot tubes for variety.
- **Levels 1–5** are hand-shaped: 2, 3, 3, 4 and 4 colors, with a guided first level.

Result from `node tools/build-levels.js` (about 45 seconds on 12 threads):

| Chapter | Levels | Mean score | Range |
|---|---|---:|---|
| 1 First Drops | 1–20 | 3.72 | 2.91–4.85 |
| 2 Rinse Cycle | 21–40 | 4.53 | 3.53–5.91 |
| 3 Bench Work | 41–60 | 5.27 | 4.19–6.68 |
| 4 Titration | 61–80 | 5.92 | 4.72–7.34 |
| 5 Distillation | 81–100 | 6.50 | 5.31–7.66 |
| 6 Centrifuge | 101–120 | 7.06 | 5.82–8.36 |
| 7 Catalyst | 121–140 | 7.67 | 6.44–9.02 |
| 8 Chromatography | 141–160 | 8.17 | 6.96–9.46 |
| 9 Crystal Garden | 161–180 | 8.68 | 7.37–10.02 |
| 10 Grand Assay | 181–200 | 9.10 | 7.93–10.41 |

The median gap between a level's target and its actual score is 0.03 (90th percentile 0.13). `tools/test.js` checks that every chapter is harder on average than the one before.

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
| Overall ramp or length | `campaignTarget` (constants 2.9, 6.4, 0.75) and `TOTAL_LEVELS` |
| Rhythm within a block | `BEAT` |
| How the player model plays | `moveAppeal`, and the temperature in `explore` |
| Size choice | `sizeForTarget`, and `SIZE_TABLE` (rerun `tools/calibrate.js`) |
| Endless adaptation | the dial steps in `win()` in `js/game.js`, and `autoTarget` |

Then run `node tools/build-levels.js && node tools/test.js`.

## Next step: real player data

The score is a model of a player, not a real player. Before a real launch:

1. **Log per level:** time to solve, moves, undos, restarts, hints and quits. All of it is available in `G` at the end of `win()`.
2. **Fit the model.** Regress solve time against score. If the curve bends, adjust `rating` or the exponent in `campaignTarget`. If some levels are outliers, look at their `trick` value; the player model's preferences in `moveAppeal` may need reweighting.
3. **Watch quit rates by beat position.** If bosses cause quits, shrink the +1.2. If breathers get skipped, they're too easy.
