#!/usr/bin/env python3
"""
Consult OpenAI for fresh order-phrasing variations for Levels 11-20 (10 per level),
each kept within that level's difficulty. Mirrors the Levels 1-10 set in
VARIATIONS.md / order-variations.json.

Reads OPENAI_API_KEY from .env (never printed). Writes:
  order-variations-11-20.json   {generated_at, model, levels:{11:[...],...}}
  VARIATIONS-11-20.md           human-readable, one section per level

Run:  python3 tools/consult-variations.py
"""
import json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_env():
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


# Concise engine description shared by every prompt.
PREAMBLE = """\
Pizza Palace is a children's reading-comprehension game. A customer's order is a
short piece of English; the child reads it and builds an 8-slice pizza to match.

THE PIZZA: 8 wedges in a ring. Each wedge has exactly one BASE (tomato, cheese,
or bbq) and a set of TOPPINGS stacked on it.

TOPPINGS: pepperoni, ham, bacon, sausage, meatball, chicken (meats);
mushroom, pepper, onion, olive, spinach, sweetcorn (vegetables);
pineapple, banana, raisins (fruits); broccoli, green beans, brussels sprout,
peas, beetroot, banana, raisins, marshmallow, fish heads (silly). Note broccoli
is a vegetable AND silly; banana/raisins are fruit AND silly. chilli, tomato
slice, extra cheese also exist.

NAMED RECIPES (built from raw toppings, recalled from memory): Margherita,
Pepperoni Classic, Hawaiian, Cheesy Cheese Dream, Meat Feast, Veggie Supreme,
BBQ Chicken, Dragon's Breath, Popeye Power-Up, Gone Bananas, Lunchbox Tragedy.

ORIENTATION-FREE RULE (critical): the pizza can be rotated/flipped, so orders MUST
use RELATIONAL language ("one half / the other half", "the quarter opposite",
"two slices that aren't touching", "every other slice", "going around: first
three..."), NEVER fixed directions ("top-left", "the 3 o'clock slice").

THE GRADER SUPPORTS: fixed toppings per slice; "any N different <category> on
every slice" (child chooses which); count ranges ("more than two meats", "fewer
than five"); "surprise me" wildcard regions; multiple acceptable readings;
recipes; negation/exception; conditionals keyed to a base; rules with strength
(MUST / MAY / MUST NOT). Each variation must be gradeable with these.
"""

# Per-level concept briefs (Levels 11-20), matching the engine's templatesForTier.
LEVELS = {
    11: "diagonal quarters (two quarters corner-to-corner); 'everything except one quarter'; self-correction ('actually, scrap that...'); 'any N different <category> on every slice'; count comparisons (more than / fewer than); shared-property grouping by COLOUR ('one green topping on every slice').",
    12: "alternating 'every other slice'; two different bases on one pizza; self-correction garden-path orders; diagonal quarters; count comparisons. Multi-topping (two stacked) is common.",
    13: "ordinal run going around ('first three X, next three Y, last two plain'); alternating; a 'surprise me / your choice' wildcard region combined with a pinned region; a topping that goes ONLY on the slices of one named base.",
    14: "named recipes over whole/halves; two toppings stacked on a half; 'any 3 meats on one half, any 3 vegetables on the other'; a topping only on one base's slices; dietary inference ('can't eat meat' -> a vegetable instead); either/or (pick one of two); cover-all-with-one-slice-exception.",
    15: "recipes on halves and quarters; THREE toppings stacked on a half; three different bases on one pizza; 'hold the X' recipe removal; either/or; intersection category (a topping that is BOTH a fruit AND silly); rules using MUST / MAY / MUST NOT.",
    16: "a recipe on a single quarter; nested exception (a region except its end slice); implied share (a family of people -> quarters, each person's pizza); a named diagonal; 'swap the X for Y' in a recipe; intersection category; a conditional that states a true fact then acts on it; cover-all-with-one-slice-exception.",
    17: "four DIFFERENT quarters; dense 3-clause composite orders; an in-order distractor (irrelevant chatter to read past); a topping only on one of three bases; a buffer/gap slice kept between two groups; a recipe on a half minus one topping; not-both (one or the other, never both); deduction by elimination (the topping that is not meat, not veg, not fruit).",
    18: "3-clause composites; per-slice instructions (each of several slices individually); a constraint (exactly two non-adjacent slices in one half); layer conditional ('where the X meets the Y, add Z'); toppings keyed to bases; MUST/MAY/MUST NOT rules; uneven share (one half split 3-to-1 between two named kids, one eats more).",
    19: "4-clause composites; a dietary rule where vegetables must NEVER touch meat, with a plain buffer slice; recipe halves with an exception slice; four different quarter-recipes; long compound multi-sentence orders; uneven share. Very hard.",
    20: "the hardest: dense 4-clause composites; veg-never-touches-meat with a buffer; recipe halves with a nested exception; four quarter-recipes in one pizza. Multi-sentence, multiple interacting constraints, distractor chatter. Should never read as an easy order in disguise.",
}

MODELS = [m for m in [os.environ.get("OPENAI_MODEL"), "gpt-5.5", "gpt-5", "gpt-4.1", "gpt-4o"] if m]


def call(model, level, brief):
    user = (
        PREAMBLE
        + f"\nLEVEL {level} DIFFICULTY: {brief}\n\n"
        + f"Give EXACTLY 10 fresh, varied order phrasings for Level {level}. Stay strictly "
        + "within this level's difficulty (not easier, not harder). Vary the customer voice, "
        + "toppings, bases and which concept is featured. Obey the orientation-free rule. "
        + 'Respond with ONLY a JSON object: {"variations":[{"order":"<the sentence the '
        + 'customer says>","layout":"<one-line description of the correct 8-wedge build>",'
        + '"concept":"<the main concept tested>"}, ... 10 items]}'
    )
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a meticulous children's reading-game level designer. Output only valid JSON."},
            {"role": "user", "content": user},
        ],
        "response_format": {"type": "json_object"},
    }).encode()
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=body,
        headers={
            "Authorization": "Bearer " + os.environ["OPENAI_API_KEY"],
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=600) as r:  # up to 10 minutes per level
        out = json.loads(r.read())
    content = out["choices"][0]["message"]["content"]
    return json.loads(content)["variations"]


def main():
    load_env()
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("OPENAI_API_KEY not found in .env")

    primary = MODELS[0]
    fallback = "gpt-4o"  # fast + capable; used only if the primary keeps timing out
    # Merge with any levels already written, so a re-run (e.g. for the levels a
    # slow model timed out on) never clobbers completed work.
    out_path = os.path.join(ROOT, "order-variations-11-20.json")
    levels_out = {}
    used_model = primary
    if os.path.exists(out_path):
        prev = json.load(open(out_path))
        used_model = prev.get("model", primary)
        for k, v in prev.get("levels", {}).items():
            levels_out[int(k)] = v
    only = os.environ.get("LEVELS_ONLY")
    want = [int(x) for x in only.split(",")] if only else list(LEVELS)

    def write_out():
        stamp = datetime.now(timezone.utc).isoformat()
        out = {"generated_at": stamp, "model": used_model, "levels": levels_out}
        json.dump(out, open(os.path.join(ROOT, "order-variations-11-20.json"), "w"), indent=2)
        md = [f"# Order variations (Levels 11-20)\n",
              f"Reference set of fresh order phrasings (10 per level), generated by an OpenAI "
              f"consult (model {used_model}) for the harder, logic-heavy levels. Authoring source "
              f"only; not yet wired into the engine.\n"]
        for lvl in LEVELS:
            if lvl not in levels_out:
                continue
            md.append(f"\n## Level {lvl}\n")
            for i, v in enumerate(levels_out[lvl], 1):
                md.append(f'{i}. "{v.get("order","").strip()}"  ')
                md.append(f'   _layout:_ {v.get("layout","").strip()}  ')
                if v.get("concept"):
                    md.append(f'   _concept:_ {v.get("concept").strip()}')
        open(os.path.join(ROOT, "VARIATIONS-11-20.md"), "w").write("\n".join(md) + "\n")

    # Each level: try the primary model twice, then the fast fallback once. Never
    # abort the whole run on one failure; write after every success so progress
    # survives a timeout/kill.
    for lvl in want:
        if lvl in levels_out:
            print(f"level {lvl}: already present, skipping", flush=True)
            continue
        brief = LEVELS[lvl]
        attempts = [(primary, 1), (primary, 2), (primary, 3)]  # stay on gpt-5.5; retry, don't downgrade
        for m, n in attempts:
            try:
                vs = call(m, lvl, brief)
                levels_out[lvl] = vs
                used_model = m if m == primary else f"{primary} (+{fallback} fallback)"
                print(f"level {lvl}: {len(vs)} variations (model {m}, try {n})", flush=True)
                write_out()
                break
            except Exception as e:
                msg = e.read().decode()[:150] if isinstance(e, urllib.error.HTTPError) else str(e)
                print(f"level {lvl}: attempt {m}/{n} failed -> {msg}", file=sys.stderr, flush=True)
        else:
            print(f"level {lvl}: SKIPPED after all attempts", file=sys.stderr, flush=True)
        time.sleep(1)

    got = sorted(levels_out)
    print(f"done: {len(got)}/10 levels ({got}); wrote order-variations-11-20.json + VARIATIONS-11-20.md")


if __name__ == "__main__":
    main()
