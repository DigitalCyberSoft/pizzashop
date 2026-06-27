# 🍕 Pizza Palace

A browser game that teaches a child to **read and interpret increasingly complex
English**. The customer describes a pizza in words; the player reads the order and
builds it by tapping toppings onto the pizza slices. The teaching target is the
*language*, not the manual dexterity: orders climb from "a whole pizza with ham"
to multi-sentence instructions with recipes, negations, conditionals, and spatial
constraints.

No build step, no server, no dependencies. It is plain HTML, CSS, and classic
`<script>` JavaScript, so it runs straight from a `file://` double-click or from
GitHub Pages.

## ▶ Play it now: <https://digitalcybersoft.github.io/pizzashop/>

- **Online:** **<https://digitalcybersoft.github.io/pizzashop/>** — the landing
  page with a Play button (the game itself is
  [`game.html`](https://digitalcybersoft.github.io/pizzashop/game.html)). See
  [GitHub Pages setup](#github-pages-setup) below.
- **Locally:** open `game.html` in any modern browser. No install.

## How it works

The order is generated as a structured **layout spec** (6 to 12 slices depending on
the level, each with a base and a set of toppings); the English sentence is rendered
*from* that spec. The
player rebuilds a layout by tapping. Grading compares the two per slice, scoring
both layers (base + topping set), and accepts the full rotation/reflection orbit
so any valid reading of a relational order ("two slices next to each other") earns
full marks. The order text never has to be parsed back: the spec it was rendered
from is the ground truth.

- **30 difficulty levels.** Driven by adaptive difficulty, not order count. A fast,
  accurate pizza (earns the speed tip) nudges the level up; from **level 10** up it
  takes two tipped wins in a row to climb one rung. A refusal or a timeout nudges it
  down. The stored level lives in `localStorage`, so a returning player resumes where
  they were. Reaching a new personal-best level shows a **Level Up!** celebration
  (record-gated in `LS.bestLevel`, so re-climbing a level is silent); beating the game
  is **five tipped wins in a row** at the top level.
- **The pizza grows with the level.** The youngest levels use a small **6-slice** pie
  (whole and halves only); quarters arrive on the **8-slice** pizza; the hardest levels
  serve larger **10- and 12-slice** pizzas where more positions must be tracked. Fewer
  slices render smaller, more slices larger.
- **Fractions, then percents.** The slice count doubles as a fractions curriculum: thirds
  and sixths on the 6-slice, quarters and eighths on the 8, fifths on the 10. From **level
  15** orders also speak in **percent**, kept a clean integer by living only on the 8- and
  10-slice (25% = a quarter, 30% = 3 of 10 since each slice is 10%). The early quarter/half
  orders already name the percent in passing ("three quarters (that is 75%)"), so the word
  is familiar long before it is graded.
- **Economy.** Start with $20. Each pizza costs $3 to make. Accuracy pays it back
  (more for harder pizzas); a quick, accurate build adds a $1 tip. A wrong pizza is
  refused (you still lose the $3). Below $3 the day is over.
- **Ingredients unlock gradually**, one at a time, each with an intro beat, so the
  tray never overwhelms a young player and every food word is taught before use.
- **Recipes** (Hawaiian, Meat Feast, ...) are defined the first time they appear,
  then named bare later; the player rebuilds them from raw chips from memory.
- **Vocabulary help fades.** Hard words in an order are highlighted and tap-to-explain
  through level 17. From **level 18** that help is shown only on the Get Ready screen;
  during play the order is plain, so the child reads it unaided at the top levels.

See [`LEVELS.md`](LEVELS.md) for the full per-level design and the levers tuned at
each tier.

## Project structure

```
game.html          markup; loads the two scripts and styles.css
game-core.js       pure logic (no DOM): geometry, order generator, English
                   renderer, grader, recipe + cast data. UMD: window.Core in the
                   browser, module.exports under node (this is what the tests load).
game-ui.js         DOM, pointer (tap) input, wedge hit-test, render, game loop.
styles.css         all game styling
index.html         GitHub Pages landing page (kids + parents); links to game.html
LEVELS.md          30-level design spec and difficulty levers
assets/
  customers/*.png  AI-generated customer portraits (committed; regen with tools/)
  toppings/*.png   topping art (one transparent piece per ingredient)
  bases/*.png      tomato / cheese / bbq bases
  scene/*.png      shop background (shop-1.png .. shop-25.png; levels 26-30 reuse shop-25)
  favicon.svg
tools/
  generate-art.py  dev-time OpenAI image generator (not needed to play)
  test-core.js     node test suite for game-core.js
.env               OPENAI_API_KEY (gitignored, never committed)
```

## Developer hooks

Append to the URL while testing:

| Hash | Effect |
|------|--------|
| `#play` | skip the intro, start a game |
| `#nointro` | mark every ingredient as already seen (no unlock beats) |
| `#demo` | auto-fill the current order |
| `#win` / `#victory` | jump to the win / victory screen |
| `#selftest` | run the core assertions in-page and show a pass/fail banner |

## Tests

```
node tools/test-core.js
```

Exercises `game-core.js` directly: region maps, generator legality per tier,
recipe expansion, two-layer grading, rotation/reflection invariance, category
predicates (meat / veg / silly / fruit, including the deliberate overlaps),
wildcard and category-count slices, and the worked complex-tier examples. Exits
non-zero on any failure. The same assertions run in-browser via `game.html#selftest`.

## Art generation

All art except the favicon is produced by `tools/generate-art.py` using OpenAI's
`gpt-image-1`. The game falls back to emoji/placeholders when a PNG is missing, so
it is fully playable before or without running the script.

```
python3 tools/generate-art.py                 # generate anything missing
python3 tools/generate-art.py --force         # regenerate everything
python3 tools/generate-art.py --group toppings
python3 tools/generate-art.py --only dino,pepperoni,shop
```

**API key.** `OPENAI_API_KEY` is read only from the environment or `./.env`, which
is gitignored. The key MUST NOT be committed or placed in any game file. Generating
images costs money; the script prints the count before spending.

## Sound

Sound effects are short **recorded mp3 samples** in `assets/sfx/` (one per game
event: place, box, coin, success/perfect, fail, fanfares, cheer, ...). They are
from [Kenney](https://kenney.nl) and are **CC0 / public domain** (see
`assets/sfx/CREDITS.txt`). mp3 is used because iOS Safari (the tablet target)
cannot play `.ogg`. Playback is via `HTMLAudioElement`, which works from `file://`
(unlike `fetch()`/`decodeAudioData`, which is CORS-blocked locally); a missing file
just plays nothing, so the game stays playable without the assets. A mute toggle in
the HUD persists in `localStorage`. Audio is unlocked on the first tap (iOS policy).

`tools/generate-sfx.py` is an optional alternative that generates clips with
ElevenLabs' text-to-sound-effects API (reads `ELEVENLABS_API_KEY` from `./.env`);
it writes to the same `assets/sfx/<id>.mp3` paths, replacing the Kenney samples.

## Privacy

The game makes **no network requests** and uses **no accounts, servers, cookies, or
analytics**. All state (high score, current level, settings) lives in the browser's
`localStorage` on the player's own device under the `pizzashop.*` keys and never
leaves it. The only code that talks to the internet is `tools/generate-art.py`, a
developer tool that is not part of the running game.

## GitHub Pages setup

1. Push this repo to GitHub.
2. Settings → Pages → Build and deployment → Source: **Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. The landing page is `index.html`; the game is `game.html`. The committed
   `.nojekyll` file tells Pages to serve the `assets/` tree verbatim (Jekyll would
   otherwise skip some files).

All art is committed, so the live site shows the drawn customers, toppings, bases,
and per-level scenes with no extra step. Only `.env` (the API key) is gitignored.
