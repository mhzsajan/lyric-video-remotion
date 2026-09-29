"""check_ends.py -- which real end times were applied, and which were rejected.

WHY THIS EXISTS
---------------
`parse-lrc.mjs` accepts a real end time from a Song Timer ends file only if
it is later than its own start AND not later than the next line's start.
Anything else is discarded and the cue falls back to an ESTIMATE, which is
the lingering-lyric problem the ends file exists to solve.

It reports the count ("99 of 109") but not WHICH cues, so a song can be
partly fixed and still look wrong in the places that matter. This lists
every rejection with the reason, which is the difference between "rejected
as stale" and knowing that ten specific lines will hold for eight seconds
each.

The three rejection reasons, in the order they are checked:
  no-key     the ends file has no entry whose start matches this cue to the
             centisecond
  ends-first  the end is at or before its own start
  overlap     the end runs past the NEXT line's start, which usually means a
             mismatched or hand-edited file

Usage:
    py scripts/check_ends.py "song.remotion_start.lrc" "song.remotion_end.lrc"
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

TIME_RE = re.compile(r"^(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?")
TIME_ROW = re.compile(r"^((?:\[\d{1,3}:[0-5]?\d(?:[.:]\d{1,3})?\])+)(.*)$")
META_ROW = re.compile(r"^\[(ti|ar|al|au|by|re|ve|length|offset):(.*)\]$", re.I)
TAIL_SECONDS = 4
HOLD_SECONDS = 8

DEV = re.compile(r"[\u0900-\u097f]")


def clock(s):
    m = TIME_RE.match(s.strip())
    if not m:
        return None
    frac_raw = m.group(3) or "0"
    return (int(m.group(1)) * 60 + int(m.group(2))
            + int(frac_raw) / 10 ** len(frac_raw))


def key(t):
    return round(t * 100)


def fmt(s):
    return f"{int(s // 60)}:{s - int(s // 60) * 60:05.2f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lrc")
    ap.add_argument("ends")
    a = ap.parse_args()

    cues = []
    with open(a.lrc, encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.strip()
            if not line or META_ROW.match(line):
                continue
            m = TIME_ROW.match(line)
            if not m:
                continue
            rest = line
            stamps = []
            mm = None
            while rest.startswith("["):
                mm = rest[1:].split("]", 1)[0]
                tm = TIME_RE.match(mm)
                if not tm:
                    break
                frac_raw = tm.group(3) or "0"
                stamps.append(int(tm.group(1)) * 60 + int(tm.group(2))
                              + int(frac_raw) / 10 ** len(frac_raw))
                rest = rest[1 + len(mm) + 1:]
            text = rest.strip()
            for t in stamps:
                cues.append({"time": t, "text": text})
    cues.sort(key=lambda c: c["time"])

    ends = {}
    with open(a.ends, encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split("|", 2)
            if len(parts) < 3:
                continue
            st, en = clock(parts[0]), clock(parts[1])
            if st is None or en is None:
                continue
            ends.setdefault(key(st), {"end": en, "text": parts[2].strip()})

    applied, rejected, clamped = [], [], []
    for i, c in enumerate(cues):
        nxt = cues[i + 1]["time"] if i + 1 < len(cues) else None
        found = ends.get(key(c["time"]))
        guess = max(c["time"] + 1,
                    min(max(c["time"], nxt if nxt is not None else c["time"] + HOLD_SECONDS),
                        c["time"] + HOLD_SECONDS))
        if not found:
            rejected.append((i, c, "no-key", None, guess))
        elif found["end"] <= c["time"]:
            rejected.append((i, c, "ends-first", found["end"], guess))
        elif nxt is not None and found["end"] > nxt:
            # Clamped, not discarded: this is the singer's tail running a
            # fraction past the next line's start, which is normal. The render
            # keeps the tapped timing and pulls it back to the next start.
            clamped.append((i, c, found["end"], nxt, found["end"] - nxt))
            applied.append((i, c, nxt))
        else:
            applied.append((i, c, found["end"]))

    print(f"\n  {os.path.basename(a.lrc)}: {len(cues)} cues")
    print(f"  {os.path.basename(a.ends)}: {len(ends)} entries")
    print(f"\n  applied : {len(applied)}")
    print(f"  rejected: {len(rejected)}")
    if clamped:
        worst = max(o for *_, o in clamped)
        print(f"  clamped : {len(clamped)}  (tapped end ran past the next line's "
              f"start; worst by {worst:.2f}s)")
    print()

    if clamped:
        print("  Clamped cues keep their tapped timing, pulled back to the next")
        print("  line's start so the line clears when the next one appears:")
        for i, c, en, nxt, over in clamped:
            print(f"    {fmt(c['time'])}  {c['text'][:44]}")
        print()

    if rejected:
        print(f"  {'#':>4} {'start':>8} {'reason':<10} {'real end':>9} "
              f"{'uses':>7} {'held':>6}  text")
        print("  " + "-" * 92)
        for i, c, why, en, guess in rejected:
            real = fmt(en) if en is not None else "-"
            print(f"  {i:>4} {fmt(c['time']):>8} {why:<10} {real:>9} "
                  f"{fmt(guess):>7} {guess - c['time']:>5.1f}s  {c['text'][:34]}")
        over = sum(1 for i, c, why, en, g in rejected if g - c["time"] >= HOLD_SECONDS - 0.01)
        print(f"\n  {over} of these will sit on screen for the full "
              f"{HOLD_SECONDS}s cap instead of clearing when sung.")
        if any(why == "no-key" for i, c, why, en, g in rejected):
            print("  'no-key' means the two files disagree on the start time to\n"
                  "  the centisecond. Compare the [mm:ss.xx] in the .lrc with the\n"
                  "  first column of the ends file for the same line.")
        if any(why == "overlap" for i, c, why, en, g in rejected):
            print("  'overlap' means a real end runs past the next line's start, so\n"
                  "  the file is mismatched or hand-edited.")
    else:
        print("  every cue uses a real, tapped end time.")

    # The measurement that actually matters: how long does a line linger?
    spans = [e - c["time"] for i, c, e in applied]
    est = [g - c["time"] for i, c, why, en, g in rejected]
    if spans:
        spans.sort()
        print(f"\n  tapped line length: min {spans[0]:.2f}s  "
              f"median {spans[len(spans)//2]:.2f}s  max {spans[-1]:.2f}s")
    if est:
        est.sort()
        print(f"  estimated (rejected cues): min {est[0]:.2f}s  "
              f"median {est[len(est)//2]:.2f}s  max {est[-1]:.2f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
