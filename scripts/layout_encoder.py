"""Generic Unicode -> legacy-layout key encoder for ALL layouts npttf2utf knows.

Why: npttf2utf ships Unicode->Preeti only. Other legacy Nepali fonts use
Kantipur / PCS Nepali / Sagarmatha / Fontasy layouts — converting their text
as Preeti garbles the keys. This module encodes for any layout and VERIFIES
by decoding with npttf2utf's own FontMapper (the library is ground truth).

Support levels (verified 2026-09, 44-word battery):
  Preeti            full — npttf2utf's own convert(), 100%
  Sagarmatha        full — round-trip verified 100%
  Kantipur / PCS NEPALI / FONTASY_HIMALI_TT
                    partial — the library's maps lack a few consonants
                    (notably फ): affected words fall back to best-effort
                    keys with a loud warning; fix by hand with |keys=...

Usage:
    from layout_encoder import encode, LAYOUTS
    keys = encode("फर्केर", layout="Kantipur")
"""
import json
import os
import re
import sys

try:
    from npttf2utf.base.fontmapper import FontMapper
    import npttf2utf
    _PKG = os.path.dirname(npttf2utf.__file__)
    _MAP = os.path.join(_PKG, "map.json")
except ImportError:  # allow import from the repo without npttf2utf installed
    FontMapper = None
    _MAP = os.path.join(os.path.dirname(__file__), "map.json")

RS = "\u090b"  # ऋ

_MATRAS = "ािीुूृॄेैोौॉॅ"
_NASALS = "ंँः"
_PREBASE = "ि"  # matra drawn before the consonant
_REPH_MARKER_UNI = "र्"  # consonant र + halant at cluster start

# Some layouts have no single key for composed matras/vowels — they write the
# parts and post-rules/font-ligatures compose them. Expand BEFORE mapping so
# no Devanagari ever survives into the key text. These are exactly the
# compositions the post-rules verify (आ=अा, ऐ=एे, ओ=अेा, औ=अैा, ो=ेा, ौ=ैा)
# plus the font-ligature pairs (ई=इी, ऊ=उू) that legacy fonts draw as one glyph.
_DECOMP = {
    "आ": "अा", "ऐ": "एे", "ओ": "अेा", "औ": "अैा",
    "ो": "ेा", "ौ": "ैा",
    "ई": "इी", "ऊ": "उू",
    "ऑ": "अॅ",
}

# canonical comparison also folds the font-ligature pairs the OTHER direction
# (decoded इी == source ई) and accepts decoded-with-Parts for ligatures
import re as _re
_LIG_FOLD = [("इी", "ई"), ("उू", "ऊ")]


def _fold_ligs(s):
    for a, b in _LIG_FOLD:
        s = s.replace(a, b)
    return s


def _load():
    data = json.load(open(_MAP, encoding="utf-8"))
    layouts = {}
    for name, spec in data.items():
        r = spec["rules"]
        cmap = r["character-map"]
        inv = {}
        for key, uni in sorted(cmap.items(), key=lambda kv: -len(kv[1])):
            if uni not in inv:  # first (longest) unicode seq wins
                inv[uni] = key
        layouts[name] = {
            "inv": inv,
            "pre": [(p[0], p[1]) for p in r.get("pre-rules", [])],
            "post": [(p[0], p[1]) for p in r.get("post-rules", [])],
        }
    return layouts


LAYOUTS = _load()
NAMES = sorted(LAYOUTS.keys())


def load_extra_layouts(path):
    """Merge a generated layout file into LAYOUTS.

    npttf2utf ships five Nepali layouts. A legacy font outside those five --
    AMS Manthan among them, which produces collapsed glyphs and literal `==`
    when fed Preeti keys -- has no map anywhere, so one is generated from the
    font's published character table by scripts/anepali_charmap.py and merged
    in here.

    Round-trip verification needs npttf2utf's own decoder, which only knows its
    five. A generated layout is therefore trusted on its own evidence: the
    keys came from the publisher, the slot order was calibrated against
    Preeti, and the caller is expected to have checked the keys against the
    .ttf. `_decode` for such a layout falls back to the layout's own inverse
    map, so a round-trip still proves the encoder is self-consistent -- it
    cannot prove the published map is right, only that nothing was mangled in
    transit.
    """
    import json as _json

    with open(path, encoding="utf-8") as f:
        data = _json.load(f)
    for name, spec in data.items():
        r = spec.get("rules", spec)
        cmap = r.get("character-map", {})
        inv = {}
        for key, uni in sorted(cmap.items(), key=lambda kv: -len(kv[1])):
            if uni not in inv:
                inv[uni] = key
        LAYOUTS[name] = {
            "inv": inv,
            "pre": [(p[0], p[1]) for p in r.get("pre-rules", [])],
            "post": [(p[0], p[1]) for p in r.get("post-rules", [])],
        }
        if name not in NAMES:
            NAMES.append(name)
            NAMES.sort()
        _SELF_DECODED.add(name)
    return name


# Layouts whose keys came from a generated map rather than npttf2utf. These
# decode with their own inverse instead of the library.
_SELF_DECODED = set()

if FontMapper is not None:
    _FM = FontMapper(_MAP)
    _SUPPORTED = set(_FM.supported_maps)
else:
    _FM = None
    _SUPPORTED = set()


def _decode(keys, layout):
    """Decode key text -> unicode.

    npttf2utf's decoder is ground truth for its own five layouts. A generated
    layout has no entry there, so it decodes with its own inverse map -- see
    load_extra_layouts() for what that does and does not prove.
    """
    if layout in _SELF_DECODED:
        inv = LAYOUTS[layout]["inv"]
        fwd = {v: k for k, v in LAYOUTS[layout]["inv"].items()}
        out = []
        i = 0
        while i < len(keys):
            hit = None
            for L in range(min(4, len(keys) - i), 0, -1):
                frag = keys[i:i + L]
                if frag in LAYOUTS[layout]["inv"]:
                    hit = fwd[LAYOUTS[layout]["inv"][frag]]
                    i += L
                    break
            if hit is None:
                out.append(keys[i])
                i += 1
            else:
                out.append(hit)
        return "".join(out)
    if _FM is None:
        raise SystemExit("round-trip verification needs:  pip install npttf2utf")
    if layout not in _SUPPORTED:
        raise ValueError(f"layout {layout!r} not in npttf2utf map: {sorted(_SUPPORTED)}")
    return _FM.map_to_unicode(keys, from_font=layout)


def clusters(word):
    """Split into grapheme clusters: halant-chained consonants + matras + nasals."""
    out = []
    i, n = 0, len(word)
    while i < n:
        j = i + 1
        # halant chains: consonant ् consonant ् ... (halant then another base)
        while j + 1 <= n and j < n and word[j] == "्":
            j += 2  # halant + next base char
        # trailing matras / nasals / anusvara
        while j < n and (word[j] in _MATRAS or word[j] in _NASALS):
            j += 1
        out.append(word[i:j])
        i = j
    return out


def _cmap_keys(text, inv):
    """Greedy longest-first char-map translation; unknown chars pass through."""
    out = []
    i = 0
    while i < len(text):
        for L in range(min(4, len(text) - i), 0, -1):
            if text[i:i + L] in inv:
                out.append(inv[text[i:i + L]])
                i += L
                break
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


_REPH_KEYS = {}


def _reph_key(layout):
    """Single key that decodes to र् (reph) for this layout.

    Some layouts put it in the char-map (Sagarmatha 'Š'); others via a
    precomposed key + post-rule (Preeti '{'). Derived by testing 1-char keys.
    """
    if layout in _REPH_KEYS:
        return _REPH_KEYS[layout]
    key = LAYOUTS[layout]["inv"].get(_REPH_MARKER_UNI)
    if not key:
        # post-rules like ['{', 'र्'] carry it for Preeti-family layouts
        for pat, rep in LAYOUTS[layout]["post"]:
            if rep == _REPH_MARKER_UNI and len(pat) == 1 and pat.isprintable():
                key = pat
                break
    if not key:
        # last resort: brute single-char probe over the legacy key range
        for o in range(33, 384):
            k = chr(o)
            try:
                if _decode(k, layout) == _REPH_MARKER_UNI:
                    key = k
                    break
            except Exception:
                continue
    _REPH_KEYS[layout] = key
    return key


def _expand(text):
    out = []
    i = 0
    while i < len(text):
        for L in (2, 1):
            if text[i:i + L] in _DECOMP:
                out.append(_DECOMP[text[i:i + L]])
                i += L
                break
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def _canon(s):
    return _expand(s)


def candidates(word, layout):
    """Generate plausible key encodings; verified by decode round-trip."""
    inv = LAYOUTS[layout]["inv"]
    word = _expand(word)
    cls = clusters(word)
    outs = []

    def emit(order_reph, prebase_pos):
        parts = []
        for c in cls:
            # reph cluster: starts र् and has more after it
            if c.startswith(_REPH_MARKER_UNI) and len(c) > 2:
                rest = c[2:]
                keys = _cmap_keys(rest, inv)
                # pre-base matra inside the reph cluster
                if _PREBASE in rest:
                    rest2 = rest.replace(_PREBASE, "")
                    if prebase_pos == "front":
                        keys = inv.get(_PREBASE, "") + _cmap_keys(rest2, inv)
                    else:
                        keys = _cmap_keys(rest2, inv)
                reph = _reph_key(layout) or ""
                if order_reph == "after":
                    parts.append(keys + reph)
                elif order_reph == "before":
                    parts.append(reph + keys)
                else:  # "drop" fallback
                    parts.append(keys)
                continue
            if _PREBASE in c:
                rest = c.replace(_PREBASE, "")
                if prebase_pos == "front":
                    parts.append(inv.get(_PREBASE, "") + _cmap_keys(rest, inv))
                else:  # before last consonant's key
                    k = _cmap_keys(rest, inv)
                    # put matra before the final base consonant key
                    parts.append(k)  # crude: same as front for non-reph; decoder rules fix order
            else:
                parts.append(_cmap_keys(c, inv))
        outs.append("".join(parts))

    emit("after", "front")
    emit("after", "back")
    emit("before", "front")
    emit("drop", "front")
    # raw char-map, no reordering
    outs.append(_cmap_keys(word, inv))
    # de-dup preserving order
    seen, uniq = set(), []
    for o in outs:
        if o not in seen:
            seen.add(o)
            uniq.append(o)
    return uniq


def encode(word, layout="Preeti", prefer=None):
    """Encode unicode -> keys for `layout`, verified by decoding round-trip.

    `prefer`: optional callable word->str tried first (e.g. npttf2utf's own
    Preeti convert(), which knows composite keys).
    Returns (keys, exact: bool). Exact False means no candidate round-tripped
    cleanly; the first candidate is returned as best-effort.
    """
    cands = []
    if prefer is not None:
        try:
            cands.append(prefer(word))
        except Exception:
            pass
    cands.extend(candidates(word, layout))
    dev = lambda s: any("\u0900" <= ch <= "\u097f" for ch in s)
    for c in cands:
        if not c or dev(c):
            continue  # Devanagari in keys = font has no glyph for it
        try:
            if _fold_ligs(_canon(_decode(c, layout))) == _fold_ligs(_canon(word)):
                return c, True
        except Exception:
            continue
    # best-effort: first candidate without Devanagari, else raw first
    for c in cands:
        if c and not dev(c):
            return c, False
    return (cands[0] if cands else ""), False


def convert_fn(layout):
    """Return to-keys callable for 03_apply.py, mirroring to_legacy_keys()."""
    if layout in (None, "", "Preeti"):
        try:
            from npttf2utf.base.preetimapper import convert as preeti_convert
            return lambda w: preeti_convert(w).replace(RS, "C")
        except ImportError:
            return lambda w: encode(w, "Preeti")[0].replace(RS, "C")
    return lambda w: encode(w, layout)[0]


if __name__ == "__main__":
    words = [
        "फर्केर", "आउने", "छैन", "म", "कुनै", "ऋतु", "होइन", "बित्ला", "जिन्दगी",
        "आउँछु", "आउँदिन", "माया", "कसैको", "भावलाई", "बुझ", "तिम्रो",
        "दुईतर्फी", "विश्वास", "हुँदैन", "ट्रक", "क्रम", "त्ति", "ष्ट्रिय",
        "वार्ता", "श्री", "द्वि", "गण्डकी", "स्कूल", "ज्यानै", "सताउने",
        "पिर्ती", "हराउछु", "सम्हाल्ने", "मोहनी", "अल्लारे", "खोला", "पर्यो",
        "झुठोनि", "सोझो", "बतासे", "सन्धै", "जिस्काउदै", "हिडिन्छ", "मोहनी",
    ]
    total = ok = 0
    for layout in NAMES:
        fails = []
        for w in words:
            k, exact = encode(w, layout)
            total += 1
            if exact:
                ok += 1
            else:
                fails.append((w, k, _decode(k, layout)))
        print(f"{layout:20} {len(words) - len(fails)}/{len(words)} round-trip OK")
        for w, k, d in fails[:5]:
            print(f"    fail {w!r} -> {k!r} decodes {d!r}")
    print(f"TOTAL {ok}/{total}")
