"""diff_slots.py -- do anepali font pages list categories in the SAME order?

`anepali_charmap.py` reads a font's keys positionally, using the slot order
calibrated from the Preeti page. That is only sound if every page lists the
same Devanagari in the same order. It is an assumption about the site, and
the AMS Manthan render came out with wrong letters -- so either the order
differs, or something else is wrong. This prints the evidence.

Side by side, per category, with the Devanagari the Preeti page implies. A
column of identical meanings across both fonts means the order is shared; a
divergence pins the exact row where it breaks.

Usage:
    py scripts/diff_slots.py preeti ams-manthan [more slugs...]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from anepali_charmap import fetch, read_table, slot_order, SITE, SECTIONS  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main():
    slugs = sys.argv[1:] or ["preeti", "ams-manthan"]
    order = slot_order()

    pages = {}
    for s in slugs:
        pages[s] = read_table(fetch(f"{SITE}/font/{s}/"), s)

    ref = slugs[0]
    for frag, slots in order.items():
        ref_keys = pages[ref].get(frag, [])
        print(f"\n=== {frag} ===  (Preeti page lists {len(ref_keys)})")
        width = max(len(s) for s in slugs) + 2
        header = "  slot  " + "".join(f"{s:<{width}}" for s in slugs)
        print(header)
        print("  " + "-" * (6 + width * len(slugs)))

        n = max(len(pages[s].get(frag, [])) for s in slugs)
        for i in range(n):
            row = f"  {i:>4}  "
            for s in slugs:
                ks = pages[s].get(frag, [])
                row += f"{(ks[i] if i < len(ks) else '-'):<{width}}"
            # The meaning column: what the reference page's key decodes to.
            meaning = ""
            if i < len(ref_keys) and i < len(slots) and slots[i]:
                meaning = "  " + slots[i]
            print(row + meaning)

        # Where do the fonts disagree, row by row?
        for s in slugs[1:]:
            ks = pages[s].get(frag, [])
            same = sum(1 for i in range(min(len(ref_keys), len(ks)))
                       if ref_keys[i] == ks[i])
            total = min(len(ref_keys), len(ks))
            verdict = "IDENTICAL" if same == total else "DIFFERS"
            print(f"    {s} vs {ref}: {same}/{total} rows identical -> {verdict}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
