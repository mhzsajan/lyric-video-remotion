#!/usr/bin/env python3
"""Measure a lyric video against the reference look.

    python scripts/reference_survey.py <video>          one file, full report
    python scripts/reference_survey.py <ref> <ours>     A/B, prints a diff

Answers the questions that came up while studying
`Perfect Example/ritu-whisper.mp4` (see docs/REFERENCE.md):

  * container  - codec, pixel format, fps, and KB/s, i.e. the file-size recipe
  * extent     - the union of every position text occupies (roam safe area)
  * line bands - per-line glyph height, which is the only fair way to compare
                 size between files whose cues wrap differently
  * glow       - luminance falling away from a glyph edge, so a text-shadow
                 can be matched instead of guessed at
  * background - must be exactly black or Add/Screen blend leaves a rectangle

Numbers are printed, never judged: this script does not decide what is better.
Requires ffmpeg/ffprobe on PATH. Pillow for the frame analysis.
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required:  pip install Pillow")

# cropdetect flags: anything above ~10/255 counts as content, and reset=0 makes
# the reported box accumulate across the whole file (a union, not per frame).
CROP_ARGS = "cropdetect=limit=0.04:round=2:reset=0"
CROP_RE = re.compile(r"crop=(?P<w>\d+):(?P<h>\d+):(?P<x>\d+):(?P<y>\d+)")


def run(cmd, check=True):
    p = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    if check and p.returncode not in (0, 1):  # ffmpeg exits 1 on -f null
        raise RuntimeError(f"{cmd[0]} failed:\n{p.stderr[:2000]}")
    return p


def probe(path):
    out = run(["ffprobe", "-v", "error", "-show_entries",
               "format=duration,size,bit_rate:stream=codec_name,profile,pix_fmt,"
               "width,height,r_frame_rate,nb_frames", "-of",
               "default=noprint_wrappers=1", path]).stdout
    d = {}
    for line in out.splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            d.setdefault(k, v)
    d["duration"] = float(d.get("duration") or 0)
    d["size"] = int(d.get("size") or 0)
    d["streams"] = out.count("codec_name=")
    return d


def grab(video, t, dest):
    run(["ffmpeg", "-y", "-v", "error", "-ss", str(t), "-i", video,
         "-frames:v", "1", dest])
    return Image.open(dest).convert("RGB")


def extent(video):
    """Union of content boxes over the whole file (cumulative by design)."""
    p = run(["ffmpeg", "-hide_banner", "-i", video, "-vf", CROP_ARGS,
             "-f", "null", "-"])
    xs, ys, xe, ye, n = [], [], [], [], 0
    for m in CROP_RE.finditer(p.stderr):
        w, h, x, y = (int(m.group(k)) for k in ("w", "h", "x", "y"))
        if w >= 1900 and h >= 1070:
            continue  # fully black frame reports the whole frame
        xs.append(x); ys.append(y); xe.append(x + w); ye.append(y + h); n += 1
    if not n:
        return None
    return dict(x0=min(xs), x1=max(xe), y0=min(ys), y1=max(ye), frames=n)


def bands(img, thr=200, min_gap=6):
    """Group lit rows into text lines and measure each one."""
    img = img.convert("L")  # load() gives (r,g,b) tuples on RGB images
    w, h = img.size
    px = img.load()
    counts = [sum(1 for x in range(0, w, 2) if px[x, y] >= thr) for y in range(h)]

    lines, start, gap = [], None, 0
    for y, n in enumerate(counts):
        if n:
            if start is None:
                start = y
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                lines.append((start, y - gap))
                start = None
    if start is not None:
        lines.append((start, h - 1))

    out = []
    for y0, y1 in lines:
        xs = [x for y in range(y0, y1 + 1) for x in range(0, w, 2)
              if px[x, y] >= thr]
        if not xs:
            continue
        densest = max(range(y0, y1 + 1), key=lambda y: counts[y])
        out.append(dict(y0=y0, y1=y1, h=y1 - y0 + 1, x0=min(xs), x1=max(xs),
                        w=max(xs) - min(xs), row=densest, lit=counts[densest]))
    return [b for b in out if b["h"] > 12]


def falloff(img, band, reach=70):
    """Brightness walking out from the glyph edge along the densest row."""
    px = img.convert("L").load()
    row = band["row"]
    edge = next((x for x in range(img.size[0]) if px[x, row] >= 200), None)
    if edge is None:
        return []
    start = max(0, edge - reach)
    return [px[x, row] for x in range(start, min(img.size[0], edge + 10))]


def background(video, times, tmp, tag):
    """Worst background brightness seen across the sampled frames."""
    worst = 0
    for t in times:
        img = grab(video, t, os.path.join(tmp, f"bg_{tag}_{t}.png"))
        px = img.load()
        # Corners and a ring around them: what Add/Screen will show as a plate.
        pts = [(0, 0), (1, 1), (img.width - 1, 0), (0, img.height - 1),
               (img.width - 1, img.height - 1), (20, 20), (1900, 1060)]
        worst = max(worst, *(sum(px[x, y]) for x, y in pts))
    return worst


def report(path, times, tmp, tag):
    d = probe(path)
    size_kb = d["duration"] and d["size"] / d["duration"] / 1024
    print(f"\n=== {os.path.basename(path)} ===")
    print(f"  {d.get('codec_name')} {d.get('pix_fmt')} "
          f"{d.get('width')}x{d.get('height')} {d.get('r_frame_rate')} fps, "
          f"{d.get('profile')} profile, {d['streams']} stream(s)")
    print(f"  {d['duration']:7.2f}s  {d['size']/1024/1024:7.2f} MiB  "
          f"{size_kb:6.2f} KB/s  {d.get('bit_rate')} bps  "
          f"frames={d.get('nb_frames')}")

    bg = background(path, times, tmp, tag)
    print(f"  background worst corner sum(RGB) = {bg} "
          f"({'pure black - Add/Screen safe' if bg == 0 else 'NOT black!'})")

    ext = extent(path)
    if ext:
        print(f"  text extent  x {ext['x0']}..{ext['x1']}  "
              f"y {ext['y0']}..{ext['y1']}  "
              f"(margins L{ext['x0']} R{1920-ext['x1']} "
              f"T{ext['y0']} B{1080-ext['y1']})  "
              f"[union of {ext['frames']} content frames]")

    heights, glow_shown = [], False
    for t in times:
        img = grab(path, t, os.path.join(tmp, f"{tag}_{t}.png"))
        bs = bands(img)
        if not bs:
            print(f"  t={t:>4}s  -- black --")
            continue
        print(f"  t={t:>4}s  {len(bs)} line(s): "
              + "  ".join(f"{b['w']}x{b['h']}" for b in bs))
        heights.extend(b["h"] for b in bs)
        if not glow_shown and len(bs) == 1 and bs[0]["lit"] > 6:
            f = falloff(img, bs[0])
            if f:
                print(f"           glow, {len(f)}px out to the glyph edge:")
                print("             " + " ".join(f"{v:3d}" for v in f))
                glow_shown = True

    if heights:
        hs = sorted(heights)
        print(f"  line height median {hs[len(hs)//2]}px "
              f"(range {hs[0]}-{hs[-1]}, n={len(hs)})")
    return dict(d=d, heights=heights, extent=ext, bg=bg)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("videos", nargs="+")
    ap.add_argument("--times", default="70,95,120,145,170,200,245",
                    help="comma-separated seconds to sample "
                         "(kept clear of title-card ranges by default)")
    a = ap.parse_args()

    times = [int(t) for t in a.times.split(",") if t.strip()]
    tmp = tempfile.mkdtemp()
    results = []
    for i, v in enumerate(a.videos):
        if not os.path.exists(v):
            sys.exit(f"not found: {v}")
        results.append((v, report(v, times, tmp, f"v{i}")))

    if len(results) != 2:
        return
    (pa, ra), (pb, rb) = results
    if not ra["heights"] or not rb["heights"]:
        return

    def median(values):
        s = sorted(values)
        return s[len(s) // 2]

    na, nb = os.path.basename(pa), os.path.basename(pb)
    ma, mb = median(ra["heights"]), median(rb["heights"])
    ka = ra["d"]["size"] / ra["d"]["duration"] / 1024
    kb = rb["d"]["size"] / rb["d"]["duration"] / 1024

    print("\n=== A/B ===")
    print(f"  throughput  {na}: {ka:.2f} KB/s   {nb}: {kb:.2f} KB/s "
          f"({abs(ka - kb) / ka:.1%} apart)")
    print(f"  line height {na}: {ma}px   {nb}: {mb}px "
          f"({max(ma, mb) / min(ma, mb):.2f}x)")
    if ma != mb:
        tall_name, tall_h = (na, ma) if ma > mb else (nb, mb)
        short_name, short_h = (nb, mb) if ma > mb else (na, ma)
        print(f"  {short_name} renders smaller: to first order multiply its "
              f"--size by {tall_h / short_h:.2f} to match {tall_name}")
    print("  (line height moves with matras and stacked consonants, so treat "
          "the factor as a starting point and check it at 1080p)")


if __name__ == "__main__":
    main()
