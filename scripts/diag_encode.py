"""diag_encode.py -- why does a generated layout produce the WRONG TEXT?

Symptom: the render shows the right *kind* of Devanagari in the right font,
but the wrong letters. "रिसले" came out as "किस्तो".

That is not a font problem. It is the ENCODER emitting the wrong keys, and
the giveaway was already in the render log and easy to overlook:

    !! not round-trip exact: 'रिसले' -> 'ikrsalae'

lrc_legacy.py prints that when decoding the keys it just produced does not give
the word back. AGENTS.md says plainly: "Loud '!! not round-trip exact' on
stderr means a word needs a manual fix - do not ship it silently." It fires on
almost every word, so almost every word is wrong.

WHY ROUND-TRIP VERIFICATION DOES NOT CATCH IT HERE
-------------------------------------------------
`layout_encoder.candidates()` generates several candidate encodings and keeps
the first that decodes back to the source. For npttf2utf's five layouts that
check is meaningful. For a GENERATED layout, `_decode` is the layout's OWN
inverse map -- a naive codepoint->key->codepoint lookup that knows nothing
about ordering. So it will happily agree with a candidate that is
self-consistent and visually wrong.

It has to: a generated layout carries no pre-rules or post-rules, so the
"decoder rules fix order" comment in candidates() is simply false for it.

And order is the whole problem. A legacy font has NO shaping engine -- no
GSUB, no HarfBuzz, nothing. It draws glyphs strictly in codepoint order. So
the key sequence IS the visual order, and it must be exactly right:

    रि  ->  "ir"   (pre-base i-matra FIRST, then the consonant)
    र्क  ->  "k r"  (reph LAST, after the cluster)

Get that wrong and you get a different, valid, wrong word -- which is exactly
what "रिसले -> ikrsalae" is: an i-matra, then a KA where a RA belonged.

This script prints the encoder's output beside the source, per word, so the
failure is visible rather than inferred from a frame.

Usage:
    py scripts/diag_encode.py layouts/ams-manthan.json
    py scripts/diag_encode.py layouts/ams-manthan.json --lrc "song.lrc"
"""
import json
import os
import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def find_encoder():
    """layout_encoder.py lives in the Remotion repo, not next to this script.

    Search the usual places rather than hardcoding one, so the diagnostic
    runs on a fresh clone with the renderer checked out anywhere obvious.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(here)
    candidates = [
        os.environ.get("LYRIC_VIDEO_REMOTION"),
        repo,
        os.path.join(repo, "lyric-video-remotion"),
        r"C:\Users\Admin\tools\lyric-video-remotion",
    ]
    for c in candidates:
        if not c:
            continue
        p = os.path.join(c, "scripts", "layout_encoder.py")
        if os.path.exists(p):
            sys.path.insert(0, os.path.join(c, "scripts"))
            return c
    raise SystemExit(
        "  layout_encoder.py not found.\n"
        "  Set LYRIC_VIDEO_REMOTION to your lyric-video-remotion checkout, or\n"
        "  run this from inside that repo's scripts/ folder."
    )


RENDERER = find_encoder()
from layout_encoder import (  # noqa: E402
    LAYOUTS, _decode, _load_extra, encode,
)


def split_words(text):
    return [w for w in str(text or "").split() if w]

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# The words that matter: pre-base matra, reph, conjunct, anusvara, and the
# plain vowels. Each exercises a different ordering rule.
BATTERY = [
    "रिसले", "हिस्सी", "परेकी", "काली", "हेर", "हो", "कि", "खुसीले",
    "माया", "दुईतर्फी", "विश्वास", "आउँछु", "हावा", "सँगै", "भावलाई",
    "बुझ", "कसैको", "आँखा", "तरेकी", "ऋतु", "होइन", "जिन्दगी", "फर्केर",
    "जाऊ", "नलाऊ", "प्रीति", "ट्रक", "क्रम", "श्री", "गण्डकी", "स्कूल",
]

TIME_ROW = re.compile(r"^((\[\d{1,3}:[0-5]?\d(?:[.:]\d{1,3})?\])+)(.*)$")


def load_layout(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    name = next(iter(data))
    _load_extra(path)
    return name


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    path = sys.argv[1]
    name = load_layout(path)
    layout = LAYOUTS[name]
    print(f"\n  layout: {name}   ({len(layout['inv'])} entries)")

    words = list(BATTERY)
    lrc = None
    if "--lrc" in sys.argv:
        lrc = sys.argv[sys.argv.index("--lrc") + 1]
        seen = []
        with open(lrc, encoding="utf-8-sig") as f:
            for raw in f:
                m = TIME_ROW.match(raw.rstrip())
                if m and m.group(3).strip():
                    for w in split_words(m.group(3).strip()):
                        if w not in seen:
                            seen.append(w)
        words = seen
        print(f"  {len(words)} distinct words from {os.path.basename(lrc)}")

    print(f"\n  {'word':<18} {'keys':<20} {'decodes to':<18} ok")
    print("  " + "-" * 66)

    bad = 0
    for w in words:
        keys, exact = encode(w, name)
        try:
            back = _decode(keys, name)
        except Exception as e:
            back = f"<{type(e).__name__}>"
        ok = "ok" if exact and back == w else "MISMATCH"
        if ok != "ok":
            bad += 1
        shown = keys if len(keys) <= 18 else keys[:17] + "..."
        print(f"  {w:<18} {shown:<20} {back:<18} {ok}")

    print(f"\n  {len(words) - bad} correct, {bad} wrong")
    if bad:
        print(
            "  A legacy font draws glyphs in codepoint order with no shaping\n"
            "  engine, so the key sequence IS the visual order. A word that\n"
            "  round-trips but reads wrong means the encoder put a pre-base\n"
            "  matra in the wrong place, or picked a reph position the font\n"
            "  does not use."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
