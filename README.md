# 🍕 Pizza Palace

A browser game that teaches a child to **read and interpret increasingly complex
English**. The customer describes a pizza in words; the player reads the order and
builds it by tapping toppings onto an 8-slice pizza. The teaching target is the
*language*, not the manual dexterity: orders climb from "a whole pizza with ham"
to multi-sentence instructions with recipes, negations, conditionals, and spatial
constraints.

No build step, no server, no dependencies. It is plain HTML, CSS, and classic
`<script>` JavaScript, so it runs straight from a `file://` double-click or from
GitHub Pages.

## Play it

- **Online:** `https://<your-user>.github.io/<your-repo>/` (landing page with a
  Play button). See [GitHub Pages setup](#github-pages-setup) below.
- **Locally:** open `game.html` in any modern browser. No install.

## How it works

The order is generated as a structured **layout spec** (8 slices, each with a base
and a set of toppings); the English sentence is rendered *from* that spec. The
player rebuilds a layout by tapping. Grading compares the two per slice, scoring
both layers (base + topping set), and accepts the full rotation/reflection orbit
so any valid reading of a relational order ("two slices next to each other") earns
full marks. The order text never has to be parsed back: the spec it was rendered
from is the ground truth.

- **20 difficulty levels.** Driven by adaptive difficulty, not order count. A fast,
  accurate pizza (earns the speed tip) nudges the level up; a refusal or a timeout
  nudges it down. The stored level lives in `localStorage`, so a returning player
  resumes where they were.
- **Economy.** Start with $20. Each pizza costs $3 to make. Accuracy pays it back
  (more for harder pizzas); a quick, accurate build adds a $1 tip. A wrong pizza is
  refused (you still lose the $3). Below $3 the day is over.
- **Ingredients unlock gradually**, one at a time, each with an intro beat, so the
  tray never overwhelms a young player and every food word is taught before use.
- **Recipes** (Hawaiian, Meat Feast, ...) are defined the first time they appear,
  then named bare later; the player rebuilds them from raw chips from memory.

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
LEVELS.md          20-level design spec and difficulty levers
assets/
  customers/*.png  AI-generated customer portraits (committed; regen with tools/)
  toppings/*.png   topping art (one transparent piece per ingredient)
  bases/*.png      tomato / cheese / bbq bases
  scene/*.png      shop background, one per level (shop-1.png .. shop-20.png)
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

Most sounds are **synthesized in-browser** by a small WebAudio kit in `game-ui.js`
(place, box, coin, success/perfect, fail, fanfares, a crowd cheer), so they need no
files and work offline and from `file://`. A mute toggle in the HUD persists in
`localStorage`.

Optionally, richer recorded clips can be generated for the big moments:

```
python3 tools/generate-sfx.py            # writes assets/sfx/<id>.mp3
```

It reads `ELEVENLABS_API_KEY` from the environment or `./.env` (gitignored) and uses
ElevenLabs' text-to-sound-effects API. When a clip exists it is played (via an
`HTMLAudioElement`, which works from `file://`); when absent, the synth kit is used
instead, so the game sounds complete with or without the clips.

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
