"""tile_sheet.py -- stack labelled render rows into one image.

run:  py scripts/tile_sheet.py <list.txt> <out.png> [--crop l,t,r,b]

The list file is `path<TAB>label` per line, one per row. Rows are scaled to a
common width and stacked, each with its label drawn in the left margin --
because a contact sheet with no labels is just a wall of Devanagari, and the
whole point is to compare faces.

--crop takes a box in the SOURCE pixels and is not optional in practice. A full
1080p frame per row makes fifteen rows 12,000px tall, and at that size every
sample is a smudge -- the sheet is technically correct and practically useless.
The default box takes the horizontal band, which is where the text actually is,
so the sheet is short enough to read.

Labels are ASCII family names, drawn with PIL's default bitmap font. That font
is designed for about 11px and turns to mush above it, so each label is drawn
small and then upscaled with NEAREST: bigger and crisper than trying to hint it
at a large size, and it needs no font file to do it.
"""
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.stderr.write("Pillow is not installed: pip install pillow\n")
    sys.exit(2)

# The horizontal band sits at top 56% of a 1080p frame, so the text lives
# around y=600..820. The x range keeps the left margin of the band and most of
# its width, which is what decides how a line wraps.
DEFAULT_CROP = (150, 560, 1550, 840)

WIDTH = 1400        # every row is scaled to this, so the sheet is a rectangle
LABEL_W = 340       # left margin, in final pixels
PAD = 16
LABEL_SCALE = 3     # upscale factor for the label strip


def draw_label(label, color=(230, 237, 243)):
    """A label strip, drawn small and upscaled so it stays crisp."""
    w = max(40, 7 * len(label) + 12)
    h = 20
    tmp = Image.new("RGB", (w, h), (12, 14, 18))
    ImageDraw.Draw(tmp).text((6, 5), label, fill=color)
    return tmp.resize((w * LABEL_SCALE, h * LABEL_SCALE), Image.NEAREST)


def main():
    args = sys.argv[1:]
    crop = DEFAULT_CROP
    if "--crop" in args:
        i = args.index("--crop")
        args = args[:i] + args[i + 2:]
        crop = tuple(int(x) for x in args[-1].split(",")) if len(args) > 2 else crop
        args = args[:-1]
    if len(args) < 2:
        sys.stderr.write("usage: tile_sheet.py <list.txt> <out.png> [--crop l,t,r,b]\n")
        return 2
    list_path, out_path = args[0], args[1]

    rows = []
    for line in open(list_path, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        rows.append((parts[0], parts[1]))

    if not rows:
        sys.stderr.write("no rows in " + list_path + "\n")
        return 1

    images = []
    for p, _ in rows:
        im = Image.open(p).convert("RGB")
        # The crop is clamped to the image: a render at a different size than the
        # one the crop was chosen for should still produce a sheet, not a crash.
        w, h = im.size
        box = (max(0, min(crop[0], w)), max(0, min(crop[1], h)),
               max(1, min(crop[2], w)), max(1, min(crop[3], h)))
        if box[2] - box[0] < 8 or box[3] - box[1] < 8:
            box = (0, 0, w, h)
        im = im.crop(box)
        # Only ever scale DOWN: upscaling a crop past its source pixels makes the
        # glyph edges soft, which is exactly the thing being judged.
        scale = min(1.0, WIDTH / im.width)
        if scale < 1.0:
            im = im.resize((int(im.width * scale), max(1, int(im.height * scale))), Image.LANCZOS)
        images.append(im)

    body_h = sum(im.height for im in images) + PAD * (len(images) - 1)
    width = max(im.width for im in images)
    sheet = Image.new("RGB", (LABEL_W + width, body_h), (12, 14, 18))

    y = 0
    for im, (_, label) in zip(images, rows):
        sheet.paste(im, (LABEL_W, y))
        strip = draw_label(label)
        sheet.paste(strip, (12, y + im.height // 2 - strip.height // 2))
        y += im.height + PAD

    sheet.save(out_path)
    print("  %d rows, %dx%d" % (len(rows), LABEL_W + width, body_h))
    return 0


if __name__ == "__main__":
    sys.exit(main())
