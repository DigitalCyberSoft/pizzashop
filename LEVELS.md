# Pizza Palace: Level 1-20 Design Plan

The teaching target is reading and interpreting English, not manual dexterity.
Each level raises difficulty by advancing one or more of the levers below while
keeping the earlier ones in play. Level is driven purely by adaptive difficulty
(a speed tip raises it, a refusal or a timeout lowers it), never by order count.

**Orientation-free, relational vocabulary.** A pizza can be rotated to any angle
and handed across the counter (flipped), so there are NO absolute anchors: no
"left/right", no "top-left quarter", no "1 o'clock slice". Every reference is
relational ("one half / the other half", "the quarter across from it", "two slices
that aren't touching", "the slices either side of it", "going all the way around").
Grading accepts the full dihedral orbit (any rotation + any flip) of each order, so
a correct build scores 100% whichever way the child orients it.

## Tweakable variables (the levers)

| # | Lever | Range (easy -> hard) |
|---|-------|----------------------|
| 1 | **Partition granularity** | whole -> half -> three-region -> quarter -> adjacent pair -> single slice -> full 8-slice sequence |
| 2 | **Distinct regions / slice-states** | 1 -> 2 -> 3 -> 4 -> up to 8 |
| 3 | **Toppings per slice** | 1 -> 2 -> 3 stacked (and recipe sets of 2-5) |
| 4 | **Distinct toppings in the order** | 1 -> 2 -> 3 -> 4+ |
| 5 | **Base** | one fixed base -> player picks from unlocked -> different base per region -> a single slice's base overridden |
| 6 | **Region naming** | unnamed (any orientation accepted) -> named halves -> named quarters -> clock-named single slices |
| 7 | **Ambiguity model** | pinned (one answer) -> rotation orbit -> enumerated set -> wildcard ("surprise me") |
| 8 | **Construct family** | direct placement -> counting/adjacency -> relational (opposite/diagonal) -> negation/exception -> alternating/ordinal/sequence -> set-intersection -> nested exception -> revision/removal -> in-order distractor -> recipe -> recipe recall -> compound multi-clause |
| 9 | **Recipe load** | none -> 1 introduced (scaffolded) -> 1 recalled (faded) -> 2 recipes -> 2 recipes + a single-slice exception -> 4 recipes |
| 10 | **Scaffold vs fade** | recipe defined in the order -> named bare (player recalls it). Tracked per recipe in localStorage (`taught`). |
| 11 | **Distractor density** | none -> story-wrapper noise -> an in-order red herring naming a topping that must NOT be placed |
| 12 | **Clause count** | 1 clause -> 2 -> 3 -> 4 sequential clauses |
| 13 | **Ingredient palette** | unlocked = 4 + level (novelty/funny toppings appear from very early) |
| 14 | **Time pressure** | tip window and patience window both scale with regions/taps; tip capped at 60s |
| 15 | **Reward** | `4 + 0.5*(level-1)` per pizza, scaled by accuracy (Level 1 ~$4, Level 20 ~$13.5) |

## Level-by-level spec

| Lvl | Granularity | Regions | Top/slice | New lever this level | Construct(s) / templates | Learning goal |
|-----|-------------|---------|-----------|----------------------|--------------------------|---------------|
| 1 | whole | 1 | 1 | baseline | whole 1-topping | "whole" = all 8; follow one instruction |
| 2 | half | 2 | 1-2 | 2 regions / stacked 2 | half/half (unnamed), whole-2-topping | two regions; "both X and Y" on a slice |
| 3 | half | 2 | 1-2 | region naming | named halves, whole-2-topping | left/right/top/bottom |
| 4 | half+quarter | 3 | 1-2 | 3 regions | three-region split, double-half | a half plus two quarters |
| 5 | quarter | 2-4 | 1 | quarter granularity | quarter+rest, two quarters | quarter = 2 slices; "the rest" |
| 6 | quarter | 3-4 | 1-2 | more regions | two/three quarters, three-region | track several named quarters |
| 7 | pair | 2 | 1 | counting/adjacency | two/three in a row | "next to each other", counting |
| 8 | single slice | 2 | 1-3 | single-slice + 3 stacked | one slice, triple-whole | one-of-eight precision; 3 toppings/slice |
| 9 | mixed | 2-3 | 1 | relational + negation | opposite-of, except-quarter | "directly opposite", "all but" |
| 10 | mixed | 2-3 | 1-2 | negation emphasis | except, opposite, whole-2-topping | exclusion as the main idea |
| 11 | quarter | 2-4 | 1-3 | diagonal + revision | diagonal quarters, self-correction | "diagonally opposite"; parse a revision |
| 12 | alternating | 2-4 | 1 | alternating + mixed bases | alternating, two-bases, self-correct | "every other slice"; two bases |
| 13 | sequence | 3 | 1 | ordinal runs + open choice | ordinal run, anchored alternating, wildcard | "first three, next three"; "surprise me" |
| 14 | whole/half | 2-8 | 2-5 | **recipe introduced** | recipe whole (scaffolded), wildcard, triple | a combo name = an ingredient set |
| 15 | half | 2-8 | 2-5 | 2 recipes + intersection | recipe halves, set-intersection | recall two recipes; "in BOTH X and Y" |
| 16 | quarter | 4 | 2-5 | recipe placement + nesting | recipe quarter, nested exception, share, named diagonal | place a recipe precisely; one-slice swap; 4-person share |
| 17 | quarter/whole | 4-8 | 1-2 | composition begins (3 clauses) | four-different-quarters, composite-3, in-order distractor, negate-and-place | combine several learned clauses; ignore a red herring |
| 18 | full + constraint | 3-8 | 1-3 | composition + constraint | composite-3, per-slice, constraint, layer-conditional, negate-and-place | several rules at once; "two slices that aren't touching" |
| 19 | composite | 4-8 | 1-5 | 4 clauses + recipe recall + dietary | composite-4, dietary-share, recipe-halves+exception, 4-quarter recipes, compound | recall recipes; dietary constraint (veg across from meat) |
| 20 | composite (densest) | 4-8 | 1-5 | all levers, 5-6 sentences | composite-4, dietary-share, recipe-halves+exception, 4-quarter recipes | parse a 5-6 sentence order chaining every earlier lesson |

## Progression double-check (per lever, monotonic)

- **Granularity**: whole (1) -> halves (2-3) -> three-region (4) -> quarters (5-6) -> pairs/slices (7-8) -> sequences (13, 18) -> full composite (19-20). Rises, never regresses.
- **Regions / slice-states**: 1 -> 2 -> 3 -> 4 -> up to 8. Level 20 is guaranteed >= 3 distinct slice-states by an automated test (no "X everywhere" at the top).
- **Toppings per slice**: 1 (L1-7) -> 2 introduced (L2/4/8) -> 3 (L8/11/13) -> recipe sets of 2-5 (L14+). Multi-topping is now common from the mid game, not just the recipe tiers.
- **Construct family** strictly escalates: direct -> counting -> relational -> negation -> alternating/sequence -> intersection -> nested exception -> revision/removal -> distractor -> recipe -> recipe+exception -> compound.
- **Recipe load**: none (1-13) -> 1 scaffolded (14) -> 2 (15-16) -> recall + single-slice exception (19-20) -> 4 (17, 19, 20). Scaffold fades to bare name once `taught`.
- **Clauses**: 1 (L1-8) -> 2 (L9-13) -> 2-3 (L14-17) -> 4 (L18-20).
- **Time pressure & palette & reward** scale continuously with the level number.

### Known knobs still available to tune later
- Tighten the tip/patience windows at the top levels (currently they only scale with taps/regions).
- Add an explicit "in-order distractor" to more high levels (currently L17 only).
- Compound the share/recipe orders with a distractor clause for an even harder L20 variant.
- Per-term spatial scaffolding ("a quarter is two slices") on first use, tracked like recipes.
