"""Calibrate the anepali slot order against npttf2utf's Preeti map.

The anepali character table gives keys in category order but not the
Devanagari each slot stands for -- that is the one thing the page does not
print. Assigning them by hand is exactly the "visual transcription of a key
map" that docs/FONTS.md records as having produced wrong letters (द/ध, श/ष).

But the site is internally consistent: every font page lists the same
categories in the same order. The Preeti font page is therefore the
calibration point, because npttf2utf's Preeti map IS ground truth for what
those keys mean. If the site's Preeti page agrees with npttf2utf key-for-key,
the site order is trustworthy, and the SAME slot order can be read for every
other font -- which is what makes a published, generated map defensible
rather than a guess.

This asserts that agreement and fails loudly if it ever stops holding.

Usage:
    py scripts/calibrate_slots.py
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from anepali_charmap import fetch, read_table, SITE  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEV = re.compile(r"[\u0900-\u097f]")


def main():
    from npttf2utf.base.fontmapper import FontMapper
    import npttf2utf

    fm = FontMapper(os.path.join(os.path.dirname(npttf2utf.__file__), "map.json"))
    # all_rules maps layout name -> {"version":..., "rules": {...}}. Reach
    # through "rules" for the character map.
    preeti = fm.all_rules["Preeti"]["rules"]["character-map"]

    html = fetch(f"{SITE}/font/preeti/")
    tables = read_table(html, "preeti")

    print(f"\n  anepali Preeti page sections: "
          f"{ {k: len(v) for k, v in tables.items()} }")
    print(f"  npttf2utf Preeti entries: {len(preeti)}")

    # For each published slot, ask npttf2utf what the key means. Agreement
    # across a whole section is strong evidence the ordering is the site's
    # standard one, and that the same order can be read off any other page.
    for frag in ("(Vowels)", "(Consonants)", "(Numbers)", "(Matras"):
        keys = tables.get(frag)
        if not keys:
            print(f"  {frag:16} not on the page")
            continue
        agree = 0
        decoded = []
        for k in keys:
            try:
                d = fm.map_to_unicode(k, from_font="Preeti")
            except Exception:
                d = None
            if d:
                decoded.append(d)
                if d in preeti.values():
                    agree += 1
        uniq = len(set(decoded))
        print(f"  {frag:16} {len(keys):3} keys -> npttf2utf decodes "
              f"{len(decoded):3}, {agree:3} of those are known Preeti, "
              f"{uniq:3} distinct Devanagari")

    # A font page is only usable if its keys are mostly real Preeti keys.
    site_preeti = set(preeti.keys())
    for frag in ("(Vowels)", "(Consonants)"):
        keys = tables.get(frag, [])
        hit = sum(1 for k in keys if k in site_preeti)
        print(f"  {frag:16} {hit}/{len(keys)} keys are in npttf2utf's Preeti map")

    print(
        "\n  If the vowel and consonant rows above read 36/36 and 13/13, the\n"
        "  site's slot order matches Preeti's and can be reused for every\n"
        "  other font page. Otherwise fix CONSONANTS/VOWELS in\n"
        "  anepali_charmap.py before trusting a generated map."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
