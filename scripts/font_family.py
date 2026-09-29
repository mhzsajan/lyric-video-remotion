"""font_family.py -- a font's own family name, on stdout.

run:  py scripts/font_family.py <font file>

WHY THIS EXISTS
---------------
`render.mjs --font-file` registers a local .ttf under a family name. That name
has to be the one INSIDE the font, because a name that does not resolve does not
error: the CSS `font-family` falls through to the next entry, the browser draws
the system font, and the render comes out looking exactly as though the flag had
been ignored. There is nothing in the output to say otherwise.

Names disagree more often than you would expect between what a file calls
itself and what a README or a web page calls it, so the font is asked rather
than the flag.

Prints the name and nothing else: the caller parses stdout as a string and any
prose would become part of the family name, which is a worse failure than a
missing one. Exits non-zero on stderr when it cannot be read, and the caller
falls back to the file's own basename.
"""
import os
import sys

try:
    from fontTools.ttLib import TTFont, TTCollection
except ImportError:
    sys.stderr.write("fontTools is not installed: pip install fonttools\n")
    sys.exit(2)


def families(path):
    """Every family name in the file, best first.

    Name ID 1 is the family, ID 16 is the typographic family. ID 16 is the
    better answer when they differ -- it is the one the designer chose for
    modern applications -- but ID 1 is what older tooling and some font pickers
    show, so both are collected and the typographic one is tried first.
    """
    if path.lower().endswith((".ttc", ".otc")):
        fonts = list(TTCollection(path, lazy=False).fonts)
    else:
        fonts = [TTFont(path, fontNumber=0, lazy=False)]

    typo = []
    plain = []
    for f in fonts:
        try:
            t = f["name"].getDebugName(16)
            p = f["name"].getDebugName(1)
        except Exception:
            continue
        if t and t not in typo:
            typo.append(t)
        if p and p not in plain:
            plain.append(p)
    return typo + [p for p in plain if p not in typo]


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("usage: font_family.py <font file>\n")
        return 2
    path = sys.argv[1]
    if not os.path.exists(path):
        sys.stderr.write("no such font: " + path + "\n")
        return 1
    names = families(path)
    if not names:
        sys.stderr.write("no name table in " + path + "\n")
        return 1
    print(names[0])
    return 0


if __name__ == "__main__":
    sys.exit(main())
