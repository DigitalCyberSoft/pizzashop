#!/usr/bin/env python3
"""
Generate game sound effects with ElevenLabs' text-to-sound-effects API.

  * assets/sfx/<id>.mp3   (one short clip per id below)

Run:   python3 tools/generate-sfx.py                 # generate anything missing
       python3 tools/generate-sfx.py --force         # regenerate everything
       python3 tools/generate-sfx.py --only cheer,coin

ELEVENLABS_API_KEY is read from the environment or ./.env (gitignored). Each clip
costs API credits; the script prints the count first. Stdlib only (no pip install).

These rich clips are used for the BIG moments (a perfect pizza, victory, payment,
a level-up). The fast UI blips (placing a topping, picking a chip) stay as the
zero-latency synthesized kit in game-ui.js, because sampled playback is too laggy
and overlaps badly for rapid taps. Clips play through an HTMLAudioElement, which
works from file:// (unlike fetch()/decodeAudioData, which CORS-blocks locally).
The game falls back to the synth kit when a clip is missing, so it stays playable
before/without running this script.
"""
import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error

ENDPOINT = "https://api.elevenlabs.io/v1/sound-generation"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "assets", "sfx")

# id -> (prompt, duration_seconds). Kept short and bright for a kids' game.
SFX = [
    ("cheer", "a small crowd of happy young children cheering and clapping with joy, "
              "short and bright, cartoon game reward", 3.0),
    ("tada", "a cheerful triumphant ta-da success chime with a little sparkle, "
             "playful cartoon game", 2.0),
    ("aww", "a gentle good-natured cartoon 'aww' of mild disappointment, soft and "
            "short, not scary", 1.6),
    ("coin", "a bright cartoon coin pickup ka-ching chime, crisp and short", 1.2),
    ("levelup", "a magical sparkly power-up level-up chime, cheerful and ascending", 2.0),
]


def load_key():
    key = os.environ.get("ELEVENLABS_API_KEY")
    if key:
        return key.strip()
    env_path = os.path.join(ROOT, ".env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("ELEVENLABS_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def request(prompt, seconds, key):
    body = json.dumps({
        "text": prompt,
        "duration_seconds": seconds,
        "prompt_influence": 0.45,
    }).encode()
    req = urllib.request.Request(
        ENDPOINT, data=body,
        headers={"xi-api-key": key, "Content-Type": "application/json",
                 "Accept": "audio/mpeg"},
    )
    with urllib.request.urlopen(req, timeout=240) as resp:
        data = resp.read()
    if data[:3] != b"ID3" and data[:2] != b"\xff\xfb" and data[:2] != b"\xff\xf3":
        # not an MP3 frame/ID3 header: the API returned JSON (an error), surface it.
        raise RuntimeError("unexpected (non-mp3) response: " + data[:200].decode(errors="replace"))
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated ids")
    args = ap.parse_args()

    key = load_key()
    if not key:
        sys.exit("No ELEVENLABS_API_KEY (set it in the environment or ./.env).")
    only = set(filter(None, args.only.split(",")))
    os.makedirs(OUT, exist_ok=True)

    todo = []
    for cid, prompt, seconds in SFX:
        if only and cid not in only:
            continue
        path = os.path.join(OUT, cid + ".mp3")
        if os.path.exists(path) and not args.force:
            continue
        todo.append((cid, prompt, seconds, path))

    if not todo:
        print("Nothing to generate (all present).")
        return
    print("Generating %d sound(s) with ElevenLabs (this costs credits)." % len(todo))

    made = 0
    for cid, prompt, seconds, path in todo:
        last_err = None
        for attempt in range(3):
            try:
                mp3 = request(prompt, seconds, key)
                with open(path, "wb") as f:
                    f.write(mp3)
                made += 1
                print("  wrote %s (%d bytes)" % (os.path.relpath(path, ROOT), len(mp3)))
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
            print("  FAILED %s: %s" % (cid, last_err), file=sys.stderr)
    print("Done. %d sound(s) written." % made)


if __name__ == "__main__":
    main()
