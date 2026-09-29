"""Probe: do these legacy fonts share ONE ASCII->Devanagari key layout?

The repo's --legacy-font path assumes a font speaks one of 5 known layouts
(Preeti / Sagarmatha / Kantipur / PCS NEPALI / FONTASY_HIMALI_TT) so the
lyrics can be transcoded into that font's key sequences. That assumption is
untested for the 15 files in `01 Fonts`.

This does not read the font's *intent* -- these fonts carry no Unicode cmap
and no GSUB, so there is nothing in the file to say what a key means. What
it can do is compare the SHAPES: two fonts that put the same glyph on the
same ASCII codepoint are almost certainly speaking the same layout, and two
that differ are not.

Method: for a set of ASCII probe codepoints, pull the glyph name, then pull
a normalised outline hash of that glyph. Same outline == same key meaning.
Comparing hashes across the folder tells us how many distinct layouts are
actually in there, which is the number of maps we would need to author.

Usage:
    py scripts/layout_probe.py "path/to/fonts"
"""
import hashlib
import os
import sys

from fontTools.ttLib import TTFont

# Spread across the Preeti-occupied range: vowels, matras, consonants,
# conjuncts, digits, punctuation. Any font in this family puts Devanagari
# glyphs on most of these.
PROBE = [
    "g", "k", "n", "d", "a", "b", "f", "l", "s", "x", "z", "q", "w", "e", "o",
    "c", "m", "r", "t", "u", "v", "h", "j", ";", "i", "p", "K", "L", "M", "N",
    "O", "P", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "F", "G", "H", "J",
    "{", "}", "[", "]", "_", "\"", "+", "0", "1", "2", "3", "4", "5", "6", "7",
    "8", "9", ")", "!", "#", "$", "%", "&", "*", "(", "/", "?", "<", ">",
]

TTF_SUFFIXES = (".ttf", ".otf", ".ttc")


def family(path):
    try:
        f = TTFont(path, fontNumber=0, lazy=True)
        name = f["name"].getDebugName(1) or f["name"].getDebugName(4) or "?"
        f.close()
        return name
    except Exception:
        return "?"


def outline_hash(font, glyph_name):
    """Normalised hash of a glyph's drawn outline.

    Scaling to a fixed grid and rounding to a coarse grid first means two
    fonts that draw the same letter with slightly different control points
    still collide, while genuinely different letters do not.
    """
    try:
        from fontTools.pens.recordingPen import RecordingPen
    except ImportError:
        return None
    try:
        gs = font.getGlyphSet()
        pen = RecordingPen()
        gs[glyph_name].draw(pen)
    except Exception:
        return None

    upem = font["head"].unitsPerEm or 1000
    scale = 64.0 / upem
    ops = []

    def rnd(pt):
        return (round(pt[0] * scale), round(pt[1] * scale))

    for op, args in pen.value:
        if op in ("moveTo", "lineTo"):
            ops.append((op,) + tuple(rnd(p) for p in args))
        elif op == "qCurveTo":
            # qCurveTo may end with a None contour point; keep the shape,
            # drop the sentinel so it does not change the hash.
            pts = list(args)
            if pts and pts[-1] is None:
                pts = pts[:-1]
            flat = []
            for p in pts:
                flat.append(None if p is None else rnd(p))
            ops.append(("q",) + tuple(flat))
        elif op == "curveTo":
            ops.append((op,) + tuple(rnd(p) for p in args))
        elif op == "closePath":
            ops.append(("x",))
    return hashlib.sha1(repr(ops).encode()).hexdigest()[:12]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    roots = sys.argv[1:]
    files = []
    for r in roots:
        if os.path.isdir(r):
            for n in sorted(os.listdir(r)):
                if n.lower().endswith(TTF_SUFFIXES):
                    files.append(os.path.join(r, n))
        else:
            files.append(r)

    if not files:
        print("no font files found")
        return 1

    profiles = {}

    def profile_id(sig):
        """Stable id for a profile. hash() is salted per process, so it
        cannot be used to group or to compare across runs."""
        return hashlib.sha1("|".join(str(s) for s in sig).encode()).hexdigest()[:12]

    print(f"{'family':28} {'file':26} {'probes':>7}  profile")
    print("-" * 82)
    for path in files:
        try:
            font = TTFont(path, fontNumber=0, lazy=True)
        except Exception as e:
            print(f"{'?':28} {os.path.basename(path):26} {'-':>7}  unreadable: {e}")
            continue
        cmap = font.getBestCmap() or {}
        rev = {}
        for cp, gn in cmap.items():
            rev.setdefault(gn, cp)

        sig = []
        hit = 0
        for ch in PROBE:
            gn = cmap.get(ord(ch))
            if not gn:
                sig.append(None)
                continue
            h = outline_hash(font, gn)
            if h:
                hit += 1
            sig.append(h)
        fam = family(path)
        profiles[fam] = sig
        print(f"{fam[:28]:28} {os.path.basename(path)[:26]:26} {hit:>4}/{len(PROBE)}  "
              f"{profile_id(sig)}")
        font.close()

    print()
    groups = {}
    for fam, sig in profiles.items():
        groups.setdefault(profile_id(sig), []).append(fam)
    print(f"DISTINCT LAYOUTS: {len(groups)}")
    for i, (h, fams) in enumerate(groups.items(), 1):
        print(f"  group {i}: {', '.join(sorted(fams))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
