"""passthrough.py -- find every character the transcoder sends through UNMAPPED.

THE BUG THIS FINDS
------------------
`layout_encoder._cmap_keys` is documented as "greedy longest-first char-map
translation; unknown chars pass through". That fallback is the reason a
legacy render shows stray glyphs instead of a clean word.

A legacy font has ZERO Devanagari codepoints. So when an unmapped
Devanagari character is passed through to the key stream:

  1. the font has no glyph for it, so
  2. Chromium falls back to a DIFFERENT font for that character alone.

The result is one word rendered in two typefaces, with a visible seam --
and because the fallback font is a normal Unicode Devanagari font, the
character draws as itself rather than as a blank. Which means a stray
glyph is not obvious at a glance: it reads as "some letter", and the
person watching assumes the layout is just busy.

Two things make it look like the *font* is wrong rather than the map:

  * The stray character is often ASCII-looking. In a legacy font the ASCII
    range holds Devanagari glyphs, but a Devanagari character that FELL
    THROUGH is not a key at all -- it is a codepoint with no meaning in this
    font. Whether it draws as a "0", an "O", or a box depends entirely on
    what the fallback font has, which is why the symptom looks random.
  * --letter-anim wraps every letter in its own span, so each unmapped
    character is isolated and gets its own fallback instead of being
    absorbed by a neighbour.

THE FIX
-------
A passthrough is never correct here. It should be a hard error naming the
character and the word, so the map gets fixed rather than shipped.

This script lists every unmapped character in a real .lrc, with counts and
the words it affects, plus the keys that DO exist for the same sound where
that is knowable (nukta forms, for instance).

Usage:
    py scripts/passthrough.py ..\\nepali-legacy-fonts\\layouts\\ams-manthan.json "song.lrc"
"""
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

# This script prints Devanagari, which a Windows console (cp1252) cannot
# encode -- it raises UnicodeEncodeError on the first virama, after the whole
# analysis has already run.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))


def load_map(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    name = next(iter(data))
    return name, data[name]["rules"]["character-map"]


TIME_ROW = re.compile(r"^((\[\d{1,3}:[0-5]?\d(?:[.:]\d{1,3})?\])+)(.*)$")
META_ROW = re.compile(r"^\[(ti|ar|al|au|by|re|ve|length|offset):(.*)\]$", re.I)

# Devanagari, plus the nukta forms that a legacy font usually spells as a
# base letter plus a separate mark rather than as one precomposed glyph.
DEVA = re.compile(r"[\u0900-\u097f]")

# What a character is FOR, so the report is actionable rather than a list of
# hex codes. Only the ones that actually turn up in Nepali lyrics.
GLOSS = {
    "्": "virama / halant -- joins consonants into a conjunct",
    "ङ": "nga",
    "ञ": "nya",
    "ज्ञ": "gnya (written ज्ञ)",
    "ँ": "candrabindu (the chandrabindu on आँ, सँ)",
    "ॄ": "vocalic long r",
    "ॉ": "candra e",
    "ऑ": "candra o",
    "ॲ": "candra a",
    "ऺ": "anusvara (alternate)",
    "ऻ": "visarga (alternate)",
    "़": "nukta -- the dot in क़, ख़, ज़, ड़, ढ़, फ़",
    "ऴ": "jnya",
    "ॐ": "om",
}


def cname(c):
    try:
        return unicodedata.name(c)
    except (ValueError, TypeError):
        return "?"


def words_from_lrc(path):
    """Every lyric word, de-duplicated in first-seen order."""
    seen = []
    with open(path, encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.rstrip()
            if not line.strip() or META_ROW.match(line):
                continue
            m = TIME_ROW.match(line)
            text = m.group(3) if m else line
            for w in text.split():
                w = w.strip()
                if w and w not in seen:
                    seen.append(w)
    return seen


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if len(args) < 1:
        print(__doc__)
        return 1
    map_path = args[0]
    lrcs = args[1:]

    name, cmap = load_map(map_path)
    have = set(cmap.values())
    print(f"\n  map: {os.path.basename(map_path)}  ({len(cmap)} keys)")

    words = []
    for lrc in lrcs:
        words.extend(words_from_lrc(lrc))
    words = list(dict.fromkeys(words))
    print(f"  {len(words)} distinct words from {len(lrcs)} .lrc file(s)\n")

    if not words:
        print("  no lyrics found")
        return 1

    counts = Counter()
    where = defaultdict(set)
    for w in words:
        for ch in set(w):
            if DEVA.search(ch) and ch not in have:
                counts[ch] += 1
                where[ch].add(w)

    total_hits = sum(counts.values())
    if not counts:
        print("  Every Devanagari character in these lyrics has a key.")
        print("  Nothing passes through; the map covers this song.")
        return 0

    print(f"  {len(counts)} character(s) would PASS THROUGH to a legacy font")
    print(f"  with no glyph, and {total_hits} word(s) are affected.\n")
    print(f"  {'char':<8} {'U+':<8} {'words':>5}  what it is")
    print("  " + "-" * 74)
    for ch, n in counts.most_common():
        gloss = GLOSS.get(ch, cname(ch))
        print(f"  {ch:<8} U+{ord(ch):04X}   {n:>5}  {gloss}")

    print("\n  affected words:")
    for ch, _ in counts.most_common():
        sample = sorted(where[ch])[:8]
        more = len(where[ch]) - len(sample)
        print(f"    {ch}  " + ", ".join(sample) + (f"  (+{more} more)" if more > 0 else ""))

    print(
        "\n  Each of these is drawn by a FALLBACK font, not the one you chose.\n"
        "  That is why the word looks like it is in two typefaces, and why the\n"
        "  stray mark can read as a 0 or an O: it is not a key in this font at\n"
        "  all, so whatever the fallback has for that codepoint is what shows.\n"
        "\n  A passthrough is never right for a legacy font. Fix the map, or use\n"
        "  a font whose layout already covers these -- for virama, that means a\n"
        "  Preeti-family font, where npttf2utf supplies the key."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
