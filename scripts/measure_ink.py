"""measure_ink.py -- how wide did this calibration line actually draw?

run:  py scripts/measure_ink.py <image.png>

Prints ONE number on stdout: the width in pixels. Nothing else, because the
caller parses stdout as a number and any prose would make a parse fail silently.

WHY ONE IMAGE PER SAMPLE
------------------------
The first version put all ten samples in one tall frame and scanned each 220px
band for ink. It produced nonsense -- five Devanagari digits "measuring" 1782px
-- because a Devanagari matra at 200px extends well outside its 200px line box.
Every band's ink included its neighbours', so each number was the width of two
or three samples unioned together and the fit had nothing real to work with.

One line per image has no band boundary to get wrong, so the extent is just the
extent. The cost is ten small renders instead of one, which is the right trade:
the failure being avoided is silent, and it is silent in the direction that
makes the delivered video too small.

WHY THE INK, NOT THE LAYOUT BOX
-------------------------------
A line's layout width includes the right side bearing of the last glyph; what
the auto-fit needs is the distance the line really occupies, because that is
what has to fit in the band. So this finds the leftmost and rightmost pixel
that is not the background and reports the difference.

The plate is pure black and the text is pure white, so "not the background" is
a threshold well away from anything ambiguous. Using the image mean instead
would make the answer depend on how much text there is.
"""
import sys

try:
    from PIL import Image
except ImportError:
    sys.stderr.write("Pillow is not installed: pip install pillow\n")
    sys.exit(2)


def main():
    if len(sys.argv) < 2:
        sys.stderr.write("usage: measure_ink.py <image.png>\n")
        return 2

    im = Image.open(sys.argv[1]).convert("L")
    w, h = im.size
    # 1-bit threshold: plate is #000, text is #fff, so >40 is ink and below is
    # plate. A fixed threshold, not the mean -- the mean moves with the amount
    # of text, so a short sample and a long one would use different cutoffs and
    # the two numbers would not be comparable.
    lo = None
    hi = None
    px = im.load()
    for y in range(h):
        for x in range(w):
            if px[x, y] > 40:
                if lo is None or x < lo:
                    lo = x
                if hi is None or x > hi:
                    hi = x

    if lo is None:
        # No ink at all means the sample is missing or the font did not load.
        # Zero here would be divided by downstream and produce a nonsense fit,
        # so this is an error rather than a number.
        sys.stderr.write("no ink in the image; the font did not load\n")
        return 1

    print("%.3f" % float(hi - lo + 1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
