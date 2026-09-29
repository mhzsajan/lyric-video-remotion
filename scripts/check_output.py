"""check_output.py -- verify a rendered file, do not trust that it rendered.

A render that completes is not a render that is correct. The failures this
catches are all silent: Remotion exits 0 and prints "OK" in every case.

WHY THIS IS NOT OPTIONAL
------------------------
The roam-mode audio bug shipped and looked fine. `--mode roam` is the
recommended style, and the affected render reported success, produced the
right length, the right size and a plausible-looking video. The only
symptom was that it had no audio -- which, for a file whose whole purpose
is to be muxed against a song, is the difference between useful and
useless. Nothing in the output says "no audio".

    ffprobe -> roam: 1 stream (video)
              centre: 2 streams (video, audio)

CHECKS
------
  streams   video present; audio present unless --no-audio was used
  length    the file is as long as the audio, not just as long as the lyrics
  size      big enough to not be a truncated write
  purity    background is pure black, or the Add/Screen blend leaves a grey
            rectangle over the camera feed

Usage:
    py scripts/check_output.py <video.mp4> [more.mp4 ...]
    py scripts/check_output.py --no-audio out/Allare.mp4
    py scripts/check_output.py --audio-seconds 409.13 out/Kali.mp4
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def find_ffprobe():
    """Remotion ships one; there is rarely a system ffmpeg on a clean box."""
    exe = shutil.which("ffprobe")
    if exe:
        return exe
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pkg = os.path.join(here, "node_modules", "@remotion")
    if os.path.isdir(pkg):
        for d in os.listdir(pkg):
            for root, _dirs, names in os.walk(os.path.join(pkg, d)):
                if "ffprobe.exe" in names:
                    return os.path.join(root, "ffprobe.exe")
    return None


def find_ffmpeg():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    pkg = os.path.join(here, "node_modules", "@remotion")
    if os.path.isdir(pkg):
        for d in os.listdir(pkg):
            for root, _dirs, names in os.walk(os.path.join(pkg, d)):
                if "ffmpeg.exe" in names:
                    return os.path.join(root, "ffmpeg.exe")
    return None


def probe(path, ffprobe):
    out = subprocess.run(
        [ffprobe, "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", path],
        capture_output=True, text=True, timeout=120,
    )
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip()[:200] or "ffprobe failed")
    return json.loads(out.stdout)


def background_purity(path, ffmpeg):
    """Sample the frame corners; the plate must be pure black.

    White text on black is keyable with Add/Screen ONLY while the background
    is exactly #000000. Any lift shows as a grey rectangle over the camera
    feed -- a compression artefact, a lifted matte, anything -- and it is
    invisible in a still and obvious on a backdrop.
    """
    with tempfile.TemporaryDirectory() as td:
        png = os.path.join(td, "f.png")
        r = subprocess.run(
            [ffmpeg, "-v", "error", "-ss", "2", "-i", path, "-frames:v", "1",
             png],
            capture_output=True, text=True, timeout=120,
        )
        if r.returncode != 0 or not os.path.exists(png):
            return None, "could not extract a frame"
        try:
            from PIL import Image
        except ImportError:
            return None, "pillow not installed; skipped"
        im = Image.open(png).convert("RGB")
        w, h = im.size
        box = 12
        worst = 0
        for x0, y0 in ((0, 0), (w - box, 0), (0, h - box), (w - box, h - box)):
            for xx in range(x0, min(x0 + box, w)):
                for yy in range(y0, min(y0 + box, h)):
                    r0, g0, b0 = im.getpixel((xx, yy))
                    worst = max(worst, r0 + g0 + b0)
        return worst, None


def check(path, args, ffprobe, ffmpeg):
    problems = []
    notes = []
    name = os.path.basename(path)

    if not os.path.exists(path):
        return [f"{name}: does not exist"], notes

    size = os.path.getsize(path)
    if size < 50_000:
        problems.append(f"{name}: {size} bytes -- suspiciously small, "
                        f"a truncated or failed write")

    try:
        info = probe(path, ffprobe)
    except Exception as e:
        return [f"{name}: unreadable ({e})"], notes

    streams = info.get("streams", [])
    kinds = [s.get("codec_type") for s in streams]
    vids = [s for s in streams if s.get("codec_type") == "video"]
    auds = [s for s in streams if s.get("codec_type") == "audio"]

    if not vids:
        problems.append(f"{name}: no video stream")
    elif len(vids) > 1:
        notes.append(f"{name}: {len(vids)} video streams")

    if not auds and not args.no_audio:
        # The one that shipped. Silent, right length, exit 0, "OK" printed.
        problems.append(
            f"{name}: NO AUDIO STREAM. Either --no-audio was intended, or the "
            f"composition dropped the <Audio> element on this code path. A "
            f"file with no audio is not detectable from the render output."
        )

    dur = float(info.get("format", {}).get("duration", 0) or 0)
    if args.audio_seconds:
        want = args.audio_seconds
        if dur < want - 1.0:
            problems.append(
                f"{name}: {dur:.1f}s but the audio is {want:.1f}s -- "
                f"{want - dur:.0f}s SHORT. A --no-audio render has no audio to "
                f"probe, so the length falls back to the last lyric; pass "
                f"--length."
            )
        else:
            notes.append(f"{name}: {dur:.1f}s vs audio {want:.1f}s")

    if vids:
        v = vids[0]
        notes.append(
            f"{name}: {v.get('width')}x{v.get('height')} @ "
            f"{v.get('r_frame_rate')} {dur:.1f}s "
            f"{size/1024/1024:.1f}MB {'+audio' if auds else 'NO AUDIO'}"
        )
        if ffmpeg and not args.skip_purity:
            worst, err = background_purity(path, ffmpeg)
            if worst is not None:
                if worst > 0:
                    problems.append(
                        f"{name}: background is not pure black "
                        f"(worst corner sum(RGB) = {worst}). Add/Screen will "
                        f"not key it away; expect a grey rectangle."
                    )
                else:
                    notes.append(f"{name}: background pure black")
            elif err:
                notes.append(f"{name}: {err}")

    return problems, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+")
    ap.add_argument("--no-audio", action="store_true",
                    help="the render was --no-audio, so silence is expected")
    ap.add_argument("--audio-seconds", type=float,
                    help="the real audio length; flags a short file")
    ap.add_argument("--skip-purity", action="store_true")
    a = ap.parse_args()

    ffprobe = find_ffprobe()
    if not ffprobe:
        print("  ffprobe not found. Install ffmpeg, or run from a checkout "
              "with @remotion/compositor installed.")
        return 2
    ffmpeg = None if a.skip_purity else find_ffmpeg()

    all_problems = []
    for v in a.videos:
        p, n = check(v, a, ffprobe, ffmpeg)
        all_problems += p
        for line in n:
            print("  " + line)

    print()
    if all_problems:
        print(f"  {len(all_problems)} PROBLEM(S):")
        for p in all_problems:
            print("    - " + p)
        return 1
    print(f"  {len(a.videos)} file(s) pass every check.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
