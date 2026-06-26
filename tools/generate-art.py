#!/usr/bin/env python3
"""
Generate all game art with OpenAI's image API (gpt-image-1):

  * customer portraits   -> assets/customers/<id>.png   (opaque)
  * topping "full pizza"  -> assets/toppings/<id>.png    (transparent; scattered
                             pieces filling a circle, clipped per-wedge by the game)
  * shop interior scenes  -> assets/scene/shop-<n>.png   (opaque, one per level)
  * base sauce textures   -> assets/bases/<id>.png       (seamless, square)
  * brand logos           -> assets/logo/logo.png,       (transparent wordmark +
                             assets/logo/logo-mark.png     text-free crowned mark)

Run:   python3 tools/generate-art.py                 # generate anything missing
       python3 tools/generate-art.py --force         # regenerate everything
       python3 tools/generate-art.py --group toppings
       python3 tools/generate-art.py --only dino,pepperoni,shop

OPENAI_API_KEY is read from the environment or ./.env (gitignored). Each image
costs money; the script prints the count first. Stdlib only (no pip install).

The ids below MUST match game-core.js (CAST ids, TOPPING keys) and game-ui.js
(topping image paths). The game falls back to emoji/placeholders when a PNG is
missing, so it stays playable before/without running this script.
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error

ENDPOINT = "https://api.openai.com/v1/images/generations"
MODEL = "gpt-image-1"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CARTOON = ("Bright cartoon storybook style, thick clean outlines, flat cheerful "
           "colors, kid-friendly. ")

# The first four are the "Italian brainrot" meme characters. The model only draws
# the recognisable creature if the prompt names the meme AND its canonical
# features; a generic "goofy shark" comes back as a random shark. Keep them
# kid-friendly (the meme word steers the SHAPE, not the tone).
CUSTOMERS = [
    ("tralalero", "Tralalero Tralala, the famous Italian brainrot meme character: "
                  "a blue cartoon shark with three legs, wearing big blue Nike "
                  "sneakers, friendly goofy grin"),
    ("bombardiro", "Bombardiro Crocodilo, the famous Italian brainrot meme "
                   "character: a cartoon crocodile whose body is a little toy "
                   "bomber airplane with wings, goofy friendly happy face"),
    ("tungtung", "Tung Tung Tung Sahur, the famous Italian brainrot meme "
                 "character: a tall cartoon wooden-log person with a carved "
                 "smiling face and little wooden arms holding a small bat, goofy"),
    ("ballerina", "Ballerina Cappuccina, the famous Italian brainrot meme "
                  "character: a cartoon ballerina in a tutu whose head is a "
                  "cappuccino coffee cup with a saucer, dancing, cheerful"),
    ("nonna", "a warm smiling cartoon Italian grandmother in an apron"),
    ("chef-luigi", "a jolly cartoon Italian chef with a big moustache and white hat"),
    ("sixseven", "an excited cartoon kid holding up six fingers on one hand and seven on the other, big grin"),
    ("wizard", "a friendly cartoon wizard with a pizza-slice hat and a starry robe"),
    ("astro", "a cute cartoon ant in a tiny astronaut suit, cheerful"),
    ("dino", "a friendly round cartoon green dinosaur with a big smile"),
]

# id -> a SINGLE piece of the topping (rendered once, scattered by the game).
# Single objects come back far cleaner from the model than "scattered" prompts,
# which tempt it into drawing a whole pizza/base.
TOPPINGS = [
    ("pepperoni", "one round slice of pepperoni sausage"),
    ("ham", "one small square piece of pink ham"),
    ("bacon", "one curly strip of cooked bacon"),
    ("sausage", "one round slice of sausage"),
    ("meatball", "one round brown meatball"),
    ("chicken", "one chunk of cooked chicken"),
    ("mushroom", "one slice of mushroom"),
    ("pepper", "one curved strip of green bell pepper"),
    ("onion", "one thin onion ring"),
    ("olive", "one black olive ring"),
    ("spinach", "one small green spinach leaf"),
    ("sweetcorn", "one yellow sweetcorn kernel"),
    ("pineapple", "one yellow pineapple chunk"),
    ("tomato-slice", "one round slice of tomato"),
    ("chilli", "one small red chilli slice"),
    ("extra-cheese", "one melty blob of yellow cheese"),
    ("broccoli", "one little green broccoli floret"),
    ("green-beans", "one short green bean"),
    ("brussels-sprout", "one halved brussels sprout"),
    ("peas", "one round green pea"),
    ("beetroot", "one purple beetroot cube"),
    ("banana", "one round slice of banana"),
    ("raisins", "one small dark raisin"),
    ("marshmallow", "one white mini marshmallow"),
]

# One scene per level (tier 1..7), escalating in flair, plus a default "shop".
# All are a customer's-eye view across a front counter, no people, no text.
_COUNTER = (" seen from a customer standing at the counter, a front counter across "
            "the bottom, a pizza oven behind it, warm inviting light")
SCENE = [
    ("shop", "the inside of a cosy cartoon pizza shop" + _COUNTER),
    ("shop-1", "a cosy little cartoon pizzeria with a brick oven and a chalkboard menu" + _COUNTER),
    ("shop-2", "a sunny cartoon street-corner pizza stand with striped awning and potted plants" + _COUNTER),
    ("shop-3", "a busy lunchtime cartoon pizzeria with a queue rope and hanging garlic and salami" + _COUNTER),
    ("shop-4", "a fancy cartoon Italian trattoria with candles, checkered cloths and chandeliers" + _COUNTER),
    ("shop-5", "a breezy cartoon seaside boardwalk pizza shack with surfboards and palm trees" + _COUNTER),
    ("shop-6", "a wacky cartoon neon arcade pizza joint with glowing signs and pinball machines" + _COUNTER),
    ("shop-7", "a wild cartoon outer-space pizza station with planets and stars out the round windows" + _COUNTER),
    ("shop-8", "a cartoon underwater pizza submarine with portholes showing fish and coral" + _COUNTER),
    ("shop-9", "a cartoon jungle treehouse pizzeria with vines, leaves and a toucan" + _COUNTER),
    ("shop-10", "a cosy cartoon snowy mountain ski-lodge pizzeria with a fireplace and frosty windows" + _COUNTER),
    ("shop-11", "a cartoon desert oasis pizza caravan with palm trees, lanterns and sand dunes" + _COUNTER),
    ("shop-12", "a cartoon medieval castle pizza kitchen with stone walls, torches and banners" + _COUNTER),
    ("shop-13", "a cartoon pirate ship galley pizzeria with barrels, rope and a treasure chest" + _COUNTER),
    ("shop-14", "a cartoon prehistoric jungle pizza hut with ferns and a friendly dinosaur peeking in" + _COUNTER),
    ("shop-15", "a cartoon candy-land pizza parlour with lollipops, gumdrops and pink frosting decor" + _COUNTER),
    ("shop-16", "a cartoon robot factory pizzeria with conveyor belts, gears and blinking machines" + _COUNTER),
    ("shop-17", "a friendly cartoon haunted-mansion pizzeria with cobwebs, candles and smiling jack-o-lanterns" + _COUNTER),
    ("shop-18", "a cartoon cloud-city sky pizzeria up among fluffy clouds and rainbows" + _COUNTER),
    ("shop-19", "a cartoon volcano-side lava pizza forge with glowing orange rock and steam" + _COUNTER),
    ("shop-20", "a grand cartoon rainbow wizard-tower pizza kitchen with sparkles, stars and floating books" + _COUNTER),
]

# Brand logos (transparent). `logo` is the full wordmark badge for the landing
# page / start screen; `logo-mark` is the text-free crowned-slice emblem reused
# for the HUD icon and favicon. Text rendering from the model is imperfect, so the
# mark (no text) is the reliable one; the wordmark is decorative.
LOGO = [
    ("logo", "a fun mascot logo for a children's game called \"PIZZA PALACE\": a "
             "cheerful smiling pizza-slice character wearing a little gold crown, "
             "above a bright banner ribbon reading \"PIZZA PALACE\" in chunky "
             "playful letters"),
    ("logo-mark", "a cheerful smiling pizza-slice character mascot wearing a little "
                  "gold crown, a simple round emblem, no text"),
]

# Base textures: a SQUARE, seamless, top-down picture of just the sauce/cheese
# spread (no crust ring), tiled by the game and clipped per wedge.
BASES = [
    ("tomato", "a top-down seamless texture of smooth red tomato pizza sauce spread "
               "edge to edge, glossy, a few tiny herb flecks"),
    ("cheese", "a top-down seamless texture of melted golden mozzarella cheese spread "
               "edge to edge, gentle bubbly browned spots"),
    ("bbq", "a top-down seamless texture of glossy dark-brown BBQ sauce spread edge to "
            "edge, smoky and shiny"),
]

OUT = {
    "customers": os.path.join(ROOT, "assets", "customers"),
    "toppings": os.path.join(ROOT, "assets", "toppings"),
    "scene": os.path.join(ROOT, "assets", "scene"),
    "bases": os.path.join(ROOT, "assets", "bases"),
    "logo": os.path.join(ROOT, "assets", "logo"),
}


def load_key():
    key = os.environ.get("OPENAI_API_KEY")
    if key:
        return key.strip()
    env_path = os.path.join(ROOT, ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("OPENAI_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def prompt_for(group, desc):
    if group == "customers":
        return (CARTOON + desc + ". Centered head-and-shoulders mascot, simple "
                "plain pastel background, no text.")
    if group == "toppings":
        return (CARTOON + "A clean top-down picture of " + desc + ", on its own, "
                "centered, filling most of the frame. Fully transparent background. "
                "Absolutely NO pizza, NO dough, NO cheese base, NO sauce, NO plate, "
                "NO circle, NO frame or border, NO drop shadow, NO background — just "
                "the single piece floating on transparency. No text.")
    if group == "bases":
        return (CARTOON + desc + ". Fills the WHOLE square frame edge to edge, NO "
                "crust, NO border, NO plate, NO circle, NO text — just the flat "
                "sauce/cheese texture.")
    if group == "logo":
        return (CARTOON + desc + ". Bold playful game logo, thick outlines, vibrant "
                "colors, centered, filling most of the frame. Fully transparent "
                "background, NO plate, NO box, NO drop-shadow rectangle, NO border "
                "— just the logo floating on transparency.")
    return (CARTOON + desc + ". Wide background illustration, no people, no text.")


def request(group, prompt, key):
    body = {"model": MODEL, "prompt": prompt, "n": 1}
    if group == "toppings" or group == "logo":
        body.update({"size": "1024x1024", "background": "transparent", "output_format": "png"})
    elif group == "scene":
        body.update({"size": "1536x1024"})
    else:  # customers, bases
        body.update({"size": "1024x1024"})
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        ENDPOINT, data=data,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=240) as resp:
        out = json.load(resp)
    item = out["data"][0]
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"])
    if item.get("url"):
        with urllib.request.urlopen(item["url"], timeout=240) as r:
            return r.read()
    raise RuntimeError("unexpected response shape")


GROUPS = {"customers": CUSTOMERS, "toppings": TOPPINGS, "scene": SCENE, "bases": BASES, "logo": LOGO}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--group", default="", help="customers|toppings|scene")
    ap.add_argument("--only", default="", help="comma-separated ids")
    args = ap.parse_args()

    key = load_key()
    if not key:
        sys.exit("No OPENAI_API_KEY (set it in the environment or ./.env).")
    only = set(filter(None, args.only.split(",")))
    groups = [args.group] if args.group else ["customers", "toppings", "scene", "bases", "logo"]

    todo = []
    for g in groups:
        os.makedirs(OUT[g], exist_ok=True)
        for cid, desc in GROUPS[g]:
            if only and cid not in only:
                continue
            path = os.path.join(OUT[g], cid + ".png")
            if os.path.exists(path) and not args.force:
                continue
            todo.append((g, cid, desc, path))

    if not todo:
        print("Nothing to generate (all present).")
        return
    print("Generating %d image(s) with %s (this costs money)." % (len(todo), MODEL))

    made = 0
    for g, cid, desc, path in todo:
        prompt = prompt_for(g, desc)
        last_err = None
        for attempt in range(3):  # transient network resets happen; retry
            try:
                png = request(g, prompt, key)
                with open(path, "wb") as f:
                    f.write(png)
                made += 1
                print("  [%s] wrote %s" % (g, os.path.relpath(path, ROOT)))
                last_err = None
                break
            except urllib.error.HTTPError as e:
                detail = e.read().decode(errors="replace")[:300]
                last_err = "HTTP %s %s" % (e.code, detail)
                if e.code in (400, 401, 403):
                    sys.exit("API error for %s: %s" % (cid, last_err))
                time.sleep(2)
            except Exception as e:  # noqa: BLE001 - network reset etc., retry
                last_err = str(e)
                time.sleep(2)
        if last_err:
            print("  [%s] FAILED %s: %s" % (g, cid, last_err), file=sys.stderr)
    print("Done. %d image(s) written." % made)


if __name__ == "__main__":
    main()
