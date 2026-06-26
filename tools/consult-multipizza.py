#!/usr/bin/env python3
"""
Consult OpenAI for creative MULTI-PIZZA order variations (the two-board mechanic).

Two modes share a two-pizza screen:
  Mode A (simple, ~level 3+): each pizza is its own whole/half order, graded per
    board. e.g. "one cheese pizza and one Hawaiian pizza".
  Mode B (hard, ~level 10+): the two pizzas form ONE 16-slice pool. The order
    gives a COUNT per kind, summing to 16, in any arrangement. e.g. "2 slices of
    pepperoni, 10 slices of cheese, and the rest Hawaiian". These teach
    FRACTIONS (2/16=1/8, 10/16=5/8, 4/16=1/4). Higher levels phrase the counts
    AS fractions and the child converts to slices.

Reads OPENAI_API_KEY from .env (never printed). Writes incrementally:
  order-multipizza.json   {generated_at, model, modes:{A:[...],B:[...]}}
  MULTIPIZZA.md           human-readable reference.

Authoring reference only; every suggestion is later run through validate-orders
and only gradeable ones are wired in. Run: python3 tools/consult-multipizza.py
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


PREAMBLE = """\
Pizza Palace is a children's reading-comprehension game. A customer's order is a
short piece of English; the child reads it and builds pizzas to match.

THE PIZZA: 8 wedges in a ring. Each wedge has one BASE (tomato, cheese, or bbq)
and a set of TOPPINGS. Bases: tomato, cheese, bbq (only these three). Toppings:
pepperoni, ham, bacon, sausage, meatball, chicken (meats); mushroom, pepper,
onion, olive, spinach, sweetcorn, tomato slice (veg); pineapple, banana, raisins
(fruit); broccoli, green beans, brussels sprout, peas, beetroot, marshmallow,
fish heads (silly); chilli, extra cheese. NO other ingredients exist (no kiwi,
no jalapenos, no feta). NAMED RECIPES: Margherita, Pepperoni Classic, Hawaiian,
Cheesy Cheese Dream, Meat Feast, Veggie Supreme, BBQ Chicken, Dragon's Breath,
Popeye Power-Up, Gone Bananas, Lunchbox Tragedy.

NEW: a TWO-PIZZA screen. Two 8-slice pizzas side by side, 16 slices total.
ORIENTATION-FREE: pizzas rotate/flip and the two boards are interchangeable, so
never use fixed directions ("top-left", "3 o'clock") or "the left pizza".
"""

MODES = {
    "A": (
        "MODE A (simple, level 3+): the two pizzas are INDEPENDENT whole-pizza (or "
        "simple half) orders, one per board, graded per board in any board order. "
        "Each pizza is a single recipe or a simple fill. Example: 'One whole cheese "
        "pizza and one whole Hawaiian pizza, please!' or 'Make me a Margherita and a "
        "Meat Feast.' Keep each pizza simple and nameable; this is the gentle intro "
        "to two boards."
    ),
    "B": (
        "MODE B (hard, level 10+): the two pizzas are ONE pool of 16 slices. Give a "
        "COUNT of slices per kind, summing to exactly 16, buildable in ANY arrangement "
        "across the 16 slices. A 'kind' is a single topping on a base, a plain base, or "
        "a named recipe. These teach FRACTIONS over 16 (e.g. 4/16=1/4, 8/16=1/2, "
        "2/16=1/8). Use 2-4 kinds. Example counts must sum to 16. Lower-level phrasing "
        "uses plain counts ('2 slices of pepperoni, 10 slices of cheese, the rest "
        "Hawaiian'); higher-level phrasing states the counts AS fractions ('an eighth "
        "pepperoni, five-eighths cheese, a quarter Hawaiian') for the child to convert."
    ),
}


def call(model, mode, brief):
    user = (
        PREAMBLE
        + f"\n{brief}\n\n"
        + f"Give EXACTLY 15 fresh, varied {('Mode '+mode)} order phrasings. Vary the "
        + "customer voice, the recipes/toppings, and (for Mode B) the kind counts and "
        + "whether the phrasing is counts or fractions. Obey the orientation-free rule "
        + "and use ONLY the ingredients/recipes listed. For Mode B every order's counts "
        + "MUST sum to 16. Respond with ONLY a JSON object: "
        + '{"variations":[{"order":"<the sentence the customer says>","kinds":"<for '
        + 'Mode B: the kind:count list, e.g. pepperoni=2, cheese=10, Hawaiian=4; for '
        + 'Mode A: the two pizzas>","teaches":"<concept/fraction taught>"}, ... 15 items]}'
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
        headers={"Authorization": "Bearer " + os.environ["OPENAI_API_KEY"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        out = json.loads(r.read())
    return json.loads(out["choices"][0]["message"]["content"])["variations"]


def main():
    load_env()
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("OPENAI_API_KEY not found in .env")
    model = os.environ.get("OPENAI_MODEL", "gpt-5.5")
    out_path = os.path.join(ROOT, "order-multipizza.json")
    modes_out = {}
    if os.path.exists(out_path):
        prev = json.load(open(out_path))
        for k, v in prev.get("modes", {}).items():
            modes_out[k] = v

    def write_out():
        stamp = datetime.now(timezone.utc).isoformat()
        json.dump({"generated_at": stamp, "model": model, "modes": modes_out},
                  open(out_path, "w"), indent=2)
        md = ["# Multi-pizza order variations\n",
              f"Creative two-board order phrasings (model {model}). Authoring reference; "
              f"only variations that pass validate-orders get wired in.\n"]
        for m in ("A", "B"):
            if m not in modes_out:
                continue
            md.append(f"\n## Mode {m}\n")
            for i, v in enumerate(modes_out[m], 1):
                md.append(f'{i}. "{v.get("order","").strip()}"  ')
                if v.get("kinds"):
                    md.append(f'   _kinds:_ {v.get("kinds").strip()}  ')
                if v.get("teaches"):
                    md.append(f'   _teaches:_ {v.get("teaches").strip()}')
        open(os.path.join(ROOT, "MULTIPIZZA.md"), "w").write("\n".join(md) + "\n")

    for m, brief in MODES.items():
        if m in modes_out:
            print(f"mode {m}: already present, skipping", flush=True)
            continue
        for attempt in (1, 2, 3):
            try:
                vs = call(model, m, brief)
                modes_out[m] = vs
                print(f"mode {m}: {len(vs)} variations (try {attempt})", flush=True)
                write_out()
                break
            except Exception as e:
                msg = e.read().decode()[:150] if isinstance(e, urllib.error.HTTPError) else str(e)
                print(f"mode {m}: attempt {attempt} failed -> {msg}", file=sys.stderr, flush=True)
        time.sleep(1)
    print("done: modes " + ", ".join(sorted(modes_out)))


if __name__ == "__main__":
    main()
