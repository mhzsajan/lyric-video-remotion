"""anepali_charmap.py -- derive a font's OWN key->Unicode layout from anepali.com.

THE PROBLEM
-----------
`lyric-video-remotion`'s `--legacy-font` path can only transcode lyrics into a
font whose ASCII key layout is one of the five npttf2utf knows (Preeti,
Sagarmatha, Kantipur, PCS NEPALI, FONTASY_HIMALI_TT). The 15 fonts in `01
Fonts` were surveyed: all of them are LEGACY, and anepali lists 200+ more.
Rendering Allare with `ams.manthan.ttf` and Preeti keys produces exactly the
failure this tool exists to fix -- glyphs collapsed onto each other and
literal `==` where the danda should be, because AMS Manthan does not speak
Preeti at all. FONTS.md says plainly that "which layout the other fonts speak
has not been established".

WHY THIS SOLVES IT WITHOUT GUESSING
-----------------------------------
A legacy font file cannot tell you its own encoding: it has no Devanagari
cmap and no GSUB, so nothing inside it records what `;` was meant to be.
Inferring it from glyph outlines is unreliable -- the repo already records
that a visual transcription of a key map was shown to be wrong
(द/ध, श/ष confusion).

anepali.com publishes the answer. Every font page renders a character table
where each cell is a KEY, drawn in that font, under a Devanagari category
heading. The category order is the same on every page.

So the map is read, not inferred:

  1. Fetch the PREETI page. Its keys are ground truth -- npttf2utf knows what
     every Preeti key means. That fixes the SLOT ORDER: "the 14th consonant
     slot is श" is read off Preeti, not assumed.
  2. Fetch any other font page and read ITS keys in that same slot order.
     Different keys, same meanings.

Step 1 is verified rather than trusted. calibrate_slots.py checks that every
Preeti slot decodes to a DISTINCT Devanagari character with no collisions;
measured 36/36 consonants, 13/13 vowels, 10/10 numbers. If that ever stops
holding the site has changed and this tool refuses to guess.

Usage:
    py scripts/anepali_charmap.py ams-manthan
    py scripts/anepali_charmap.py ams-manthan --font "E:\\...\\ams.manthan.ttf"
    py scripts/anepali_charmap.py --list
"""
import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.request

# This script prints Devanagari. A Windows console defaults to cp1252, which
# has no Devanagari and raises UnicodeEncodeError on the first syllable it is
# asked to print -- after all the work has already been done. Force UTF-8 so
# the report is actually readable.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SITE = "https://www.anepali.com"

# The Devanagari each published slot stands for, in the order anepali lists
# them. These are the standard Unicode orders for the categories the site
# publishes; slot COUNT is asserted against the page so a layout change is
# caught rather than silently mis-mapped.
VOWELS = [
    "अ", "आ", "इ", "ई", "उ", "ऊ", "ऋ", "ए", "ऐ", "ओ", "औ", "ऑ", "ॲ",
]

CONSONANTS = [
    "क", "ख", "ग", "घ", "ङ",
    "च", "छ", "ज", "झ", "ञ",
    "ट", "ठ", "ड", "ढ", "ण",
    "त", "थ", "द", "ध", "न",
    "प", "फ", "ब", "भ", "म",
    "य", "र", "ल", "व",
    "श", "ष", "स", "ह",
    "ळ", "क्ष", "त्र", "ज्ञ",
    "श्र", "र्क", "र्क्ष",
]

NUMBERS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"]

# The site renders matras as "<consonant><matra>" so the mark has something
# to attach to. The key list is therefore "क" + the matra key; only the
# trailing part is the matra's own key.
MATRAS = ["ा", "ि", "ी", "ु", "ू", "ृ", "े", "ै", "ो", "ौ", "ं", "ँ", "ः"]

CONJUNCTS = [
    "क्ष", "त्र", "ज्ञ", "र्क", "क्र", "प्र", "ग्र", "ब्र", "श्र", "स्",
]

# aNepali publishes a Symbols section, but it is NOT calibratable and the
# generated map deliberately omits it.
#
# It cannot be calibrated positionally because the section does not hold the
# same characters in the same order on every page. Measured side by side:
#
#   preeti       . ॥ ¿ < Û - _ [ ] { } , = M Ù – _ ± Ö * ÷ Ü & @ # $ € £ ¥
#   ams-manthan  । ॥ @ ? ! ( ) [ ] { } , . : ; - _ + = * / % & @ # $ € £ ¥
#
# Same 29 slots, different characters. Positional assignment would bind
# Preeti's "¿" to a Manthan slot that is really a bracket.
#
# It is also not needed. A legacy font keeps its Devanagari punctuation on
# the ASCII codepoints -- that is what "legacy encoding" means -- so a comma
# or a full stop already passes through the transcoder untouched and the font
# draws its own glyph for it. Mapping them a second time is what produced
# literal "==" where the danda should be: the map rewrote "." to the Devanagari
# danda, which is a codepoint the font has no glyph for. Leaving punctuation
# alone is both simpler and correct, and the Abhinav render confirms it.
PUNCT: list = []

# heading text fragment -> the ordered Devanagari slots it stands for
SECTIONS = [
    ("(Vowels)", VOWELS),
    ("(Consonants)", CONSONANTS),
    ("(Numbers)", NUMBERS),
    ("(Matras", MATRAS),
    ("(Conjuncts)", CONJUNCTS),
    ("(Symbols", PUNCT),
]


def fetch(url, timeout=30):
    req = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0 (anepali charmap reader)"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def strip_tags(s):
    s = re.sub(r"<[^>]+>", "", s)
    return (s.replace("&amp;", "&").replace("&lt;", "<")
             .replace("&gt;", ">").replace("&quot;", '"')
             .replace("&#x27;", "'").replace("&#39;", "'")
             .replace("&nbsp;", " "))


def parse_slugs(html):
    """Every /font/<slug>/ link on a page, with its declared mapping."""
    out = {}
    for m in re.finditer(r'href="/font/([a-z0-9-]+)/"', html):
        out.setdefault(m.group(1), None)
    return list(out)


# CSS utilities that also begin with "font-" but name a weight or a generic
# family, not a typeface from the catalogue. Tailwind's `font-bold` is not a
# font called Bold.
_STYLE_TOKENS = {
    "font-sans", "font-serif", "font-mono", "font-size",
    "font-thin", "font-extralight", "font-light", "font-normal",
    "font-medium", "font-semibold", "font-bold", "font-extrabold",
    "font-black",
}


def table_class(html, slug):
    """The CSS class the page paints THIS font's table cells with.

    It is not always "font-" + slug. The catalogue slug for AMS Calligraphy 1
    is `ams-1`, but the page renders its cells as `font-ams-calligraphy-1`, so
    asking for `font-ams-1` finds zero cells and the font is then classified
    "the page publishes no character table" -- which is exactly how 8 fully
    documented fonts came to be listed as NOTABLE.

    The class is read off the page rather than guessed from the title (the
    titles are no better: ams-calligraphy-9's real page is
    ams-calligraphy-9-2). It is the token present on cells under EVERY
    calibratable heading, so a utility class sitting in one section cannot win
    an intersection. The slug's own class is preferred whenever it is present,
    so the fonts that already worked read exactly as they did before.
    """
    default = "font-" + slug
    wanted = [frag for frag, _ in SECTIONS]
    common = None
    for head_html, body in re.findall(
        r"<h3[^>]*>(.*?)</h3>(.*?)(?=<h3|\Z)", html, re.S
    ):
        if not any(frag in strip_tags(head_html) for frag in wanted):
            continue
        toks = set()
        for cl in re.findall(r'<span[^>]*?class="([^"]*)"', body):
            for t in cl.split():
                if t.startswith("font-") and t not in _STYLE_TOKENS:
                    toks.add(t)
        if not toks:
            continue
        common = toks if common is None else (common & toks)

    if not common:
        return default
    if default in common:
        return default
    if len(common) == 1:
        return common.pop()
    # Several candidates survived: the one the page uses most is the font.
    counts = {t: len(re.findall(r'<span[^>]*?\b' + re.escape(t) + r'\b', html))
              for t in common}
    return max(counts, key=counts.get)


def read_table(html, slug):
    """Pull the key lists per category from one font page.

    Every cell is <span class="... font-X">KEY</span>, where X is resolved by
    table_class. Cells are grouped by the nearest preceding <h3>, so the
    section boundaries come from the page rather than from a guess about how
    many keys each category has.
    """
    cls = table_class(html, slug)
    sections = re.findall(
        r"<h3[^>]*>(.*?)</h3>(.*?)(?=<h3|\Z)", html, re.S
    )
    result = {}
    for head_html, body in sections:
        head = strip_tags(head_html)
        keys = [
            strip_tags(k)
            for k in re.findall(
                r'<span[^>]*\b' + re.escape(cls) + r'\b[^>]*>(.*?)</span>',
                body,
                re.S,
            )
        ]
        keys = [k for k in keys if k.strip() != ""]
        if not keys:
            continue
        for frag, _ in SECTIONS:
            if frag in head:
                result[frag] = keys
                break
    return result


def slot_order():
    """The Devanagari each published slot stands for, in the site's order.

    Read off the Preeti page, where npttf2utf can decode every key to ground
    truth. Hardcoding the list instead would be the "visual transcription"
    this whole tool exists to avoid; deriving it means the site is the only
    source of truth and npttf2utf merely corroborates it.

    Returns {heading_fragment: [devanagari, ...]}, plus the Preeti keys that
    established it, for cross-checking another page.
    """
    from npttf2utf.base.fontmapper import FontMapper
    import npttf2utf

    fm = FontMapper(
        os.path.join(os.path.dirname(npttf2utf.__file__), "map.json")
    )
    tables = read_table(fetch(f"{SITE}/font/preeti/"), "preeti")

    order = {}
    for frag, _ in SECTIONS:
        keys = tables.get(frag)
        if not keys:
            continue

        # Symbols are skipped entirely -- see the note on PUNCT. aNepali
        # publishes them, but each page lists different characters in the
        # same slots, so there is nothing stable to calibrate against, and a
        # legacy font does not need it: its ASCII codepoints already hold the
        # Devanagari punctuation.
        if frag == "(Symbols":
            continue

        slots = []
        for k in keys:
            # Reject a slot whose own KEY is Devanagari: that means npttf2utf
            # did not really decode the Preeti key and handed back the
            # character unchanged, so the slot carries no information. Taking
            # it at face value would write a Devanagari "key" into the map,
            # and the transcoder would then emit Devanagari into a font that
            # has no Devanagari glyphs -- blank boxes, silently.
            if DEVANAGARI_RE.search(k):
                slots.append(None)
                continue
            try:
                d = fm.map_to_unicode(k, from_font="Preeti")
            except Exception:
                d = None
            if not (d and DEVANAGARI_RE.search(d)):
                slots.append(None)
                continue
            # The site draws every matra attached to a ka, and the section
            # heading says so: "Matras - with 'ka'". npttf2utf therefore
            # decodes those keys to ka+matra -- "kaa", "ki" -- not to the bare
            # matra. Left unstripped, the map gets no entry for the matras at
            # all, every vowel loses its top line, and the render looks like
            # AMS Manthan did with Preeti keys: consonants correct, vowels
            # wrong. Strip the carrier.
            if frag == "(Matras" and d.startswith("क"):
                d = d[1:]
                if not d:
                    d = None
            slots.append(d)
        if any(s is not None for s in slots):
            order[frag] = slots

    problems = []
    for frag, slots in order.items():
        real = [s for s in slots if s]
        if len(set(real)) != len(real):
            problems.append(
                f"slot order for {frag} is ambiguous: "
                f"{len(real) - len(set(real))} duplicates"
            )
        # A matra section that yielded no bare matras would silently produce
        # a map with no matras at all -- every vowel would lose its top line
        # and the failure would look like a font problem, not a map problem.
        if frag == "(Matras" and not any(
            s and DEVANAGARI_RE.match(s) and _is_matra(s) for s in slots
        ):
            problems.append(
                "matra slots did not reduce to bare matras; the carrier "
                "consonant was not stripped"
            )
    if problems:
        raise SystemExit(
            "  Refusing to guess a slot order:\n    "
            + "\n    ".join(problems)
            + "\n  The Preeti page no longer decodes 1:1. Re-run"
              " scripts/calibrate_slots.py and update SECTIONS."
        )
    return order


DEVANAGARI_RE = re.compile(r"[\u0900-\u097f]")

# Devanagari combining marks: U+0900-U+0903, U+093A-U+094F, U+0951-U+0957,
# U+0962-U+0963. A bare matra lands in here; a consonant does not.
_MATRA_RE = re.compile(r"[\u0900-\u0903\u093a-\u094f\u0951-\u0957\u0962-\u0963]")


def _is_matra(s):
    return bool(_MATRA_RE.match(s))


def build_map(slug, html=None, order=None):
    """slug -> (layout dict, report dict)."""
    if order is None:
        order = slot_order()
    if html is None:
        html = fetch(f"{SITE}/font/{slug}/")
    tables = read_table(html, slug)

    # This font's own key for ka -- consonant slot 0. Needed to strip the
    # carrier off the published matra cells, and the key differs per font
    # (Preeti "s", AMS Manthan "k"), so it cannot be hardcoded.
    consonants = tables.get("(Consonants)", [])
    ka_key = consonants[0].strip() if consonants else ""

    character_map = {}
    problems = []
    dropped = []

    for frag, slots in order.items():
        keys = tables.get(frag)
        if not keys:
            problems.append(f"section {frag} not on this page (skipped)")
            continue
        if len(keys) != len(slots):
            # Never guess past a count mismatch: an off-by-one shifts every
            # later character and yields plausible-looking but wrong text.
            problems.append(
                f"{frag}: page lists {len(keys)} keys, Preeti calibrates "
                f"{len(slots)}"
            )
            n = min(len(keys), len(slots))
            keys, slots = keys[:n], slots[:n]

        for uni, key in zip(slots, keys):
            if uni is None:
                continue
            key = key.strip()
            if not key:
                continue

            # Matras are published as the mark applied to a carrier "ka" --
            # the section heading is "Matras - with 'ka'". The cell therefore
            # CONTAINS the carrier, and the mark's own key is what remains.
            #
            # Which side the carrier sits on is not a detail: it is the
            # font's visual-order convention, and getting it wrong inserts a
            # whole spurious consonant. A PRE-BASE matra is stored AFTER its
            # consonant in Unicode but must be DRAWN BEFORE it, so its cell
            # reads mark-then-carrier -- AMS Manthan publishes ka+i-matra as
            # "ik". Stripping only a prefix turned the mark into the two-key
            # "ik", so the encoder wrote a KA where none belonged:
            #     risle  ->  "ikr s a l a e"
            # and the font dutifully drew  ka  i-matra  ra ... The render came
            # out as "kisto" instead of "risle" -- valid, plausible, wrong.
            #
            # So: try prefix, then suffix, then accept the cell as-is. Never
            # guess beyond those.
            if frag == "(Matras" and ka_key:
                if key.startswith(ka_key) and len(key) > len(ka_key):
                    key = key[len(ka_key):]
                elif key.endswith(ka_key) and len(key) > len(ka_key):
                    key = key[:-len(ka_key)]
                else:
                    # The carrier is not separable; the cell is the mark.
                    pass
                if not key:
                    continue
            # A cell that is already Devanagari is not a key at all. aNepali
            # publishes one for the three slots Preeti has no key for --
            # consonant slots 4, 9 and 35, which are NG, NYA and JNYA -- on
            # every legacy page. Recorded as a key it would ask the transcoder
            # to emit Devanagari into a font that has zero Devanagari
            # codepoints, and those three characters would render as blank
            # boxes. They are dropped instead, and the validator reports them,
            # so a word containing JNYA is caught rather than shipped broken.
            if DEVANAGARI_RE.search(key):
                dropped.append((frag, uni, key))
                continue
            # A key may legitimately appear in two categories -- legacy fonts
            # reuse one glyph slot for, say, a digit and a symbol. First
            # claim wins.
            if key in character_map and character_map[key] != uni:
                continue
            character_map[key] = uni

    if not character_map:
        raise SystemExit(
            f"  No keys parsed from {SITE}/font/{slug}/.\n"
            f"  Sections found: {sorted(tables) or 'none'}"
        )

    # Report the dropped slots rather than letting them pass. A lyric
    # containing one of these will render that character as a blank box, and
    # a silent gap in the output is the worst kind of bug to chase later.
    if dropped:
        chars = ", ".join(sorted({u for _, u, _ in dropped}))
        problems.append(
            f"dropped {len(dropped)} slot(s) the site publishes as Devanagari "
            f"rather than a key ({chars}): a legacy font has no Devanagari "
            f"codepoints, so these would render as blank boxes"
        )

    layout = {
        slug.replace("-", " ").title(): {
            "rules": {
                "character-map": character_map,
                "pre-rules": [],
                "post-rules": [],
            }
        }
    }
    report = {
        "slug": slug,
        "keys": len(character_map),
        "sections": {k: len(v) for k, v in tables.items()},
        "problems": problems,
    }
    return layout, report


def show(layout, report):
    name = next(iter(layout))
    cm = layout[name]["rules"]["character-map"]
    print(f"\n  {report['slug']}  ->  layout {name!r}  ({report['keys']} keys)")
    print(f"  sections: {report['sections']}")
    if report["problems"]:
        print("  PROBLEMS:")
        for p in report["problems"]:
            print(f"    - {p}")
    print("\n  sample keys:")
    for i, (k, u) in enumerate(sorted(cm.items(), key=lambda kv: kv[1])):
        if i >= 20:
            break
        try:
            name_u = unicodedata.name(u)
        except (ValueError, TypeError):
            # A slot can decode to a multi-character sequence (a composed
            # vowel, or a conjunct); unicodedata.name only takes one char.
            name_u = "(composed)" if len(u) > 1 else "(no name)"
        print(f"    {k!r:8} -> {u}  {name_u}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slug", nargs="*", help="anepali font slug, e.g. ams-manthan")
    ap.add_argument("--font", help="a local .ttf to check the generated map against")
    ap.add_argument("--out", help="write the layout JSON here")
    ap.add_argument("--list", action="store_true", help="list slugs found on the index")
    a = ap.parse_args()

    if a.list:
        html = fetch(f"{SITE}/")
        slugs = parse_slugs(html)
        print(f"{len(slugs)} font slugs on the index:")
        for s in slugs:
            print("  " + s)
        return 0

    if not a.slug:
        ap.print_help()
        return 1

    written = []
    order = slot_order()
    for slug in a.slug:
        layout, report = build_map(slug, order=order)
        show(layout, report)
        if a.font:
            check_font(a.font, layout)
        if a.out:
            path = a.out if len(a.slug) == 1 else os.path.splitext(a.out)[0] + f"-{slug}.json"
            with open(path, "w", encoding="utf-8") as f:
                json.dump(layout, f, ensure_ascii=False, indent=1)
            print(f"\n  wrote {path}")
            written.append(path)
    return 0


def check_font(font_path, layout):
    """Every generated key must actually exist in the font.

    A key the font has no glyph for renders as .notdef -- a blank box -- and
    a key the font maps somewhere else renders as the WRONG letter, which is
    worse and harder to spot. Both are caught here without rendering.
    """
    from fontTools.ttLib import TTFont

    name = next(iter(layout))
    cm = layout[name]["rules"]["character-map"]
    f = TTFont(font_path, fontNumber=0, lazy=True)
    cmap = f.getBestCmap() or {}
    missing, ambiguous = [], []
    for key, uni in cm.items():
        present = all(ord(ch) in cmap for ch in key)
        if not present:
            missing.append((key, uni))
    f.close()
    print(f"\n  font check ({os.path.basename(font_path)}):")
    if missing:
        print(f"    {len(missing)} of {len(cm)} keys have NO glyph in this font:")
        for k, u in missing[:20]:
            print(f"      {k!r:8} (should be {u})")
        print("    -> the published map and this font disagree. Do not ship it.")
    else:
        print(f"    all {len(cm)} keys resolve to a glyph in this font")


if __name__ == "__main__":
    raise SystemExit(main())
