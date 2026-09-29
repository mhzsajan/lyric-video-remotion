"""Survey every candidate font: what it can actually render.

Two independent questions, answered from the file itself:

  1. Is it usable as a UNICODE Devanagari font? Needs Devanagari codepoints
     (U+0900-U+097F) in the cmap AND GSUB/GPOS shaping tables. Without the
     first, Chromium falls back per character; without the second, conjuncts
     and pre-base matras come out wrong.
  2. If not, is it usable as a LEGACY font via scripts/lrc_legacy.py? Those
     map ASCII only -- which is fine, because that path feeds them ASCII keys.
"""
import os
import sys
import glob

from fontTools.ttLib import TTFont

DEVA = range(0x0900, 0x0980)
LATIN = range(0x20, 0x7F)

# A few Devanagari letters every real Nepali font must have: independent
# consonants plus the ones that carry the matras this song actually uses.
CORE = {
    0x0915: "ka",    # क
    0x0918: "gha",   # घ
    0x091E: "nya",   # ञ
    0x092F: "ya",    # य
    0x0932: "la",    # ल
    0x0938: "sa",    # स
    0x0923: "nna",   # ण
    0x093F: "i-matra",   # ि  (pre-base)
    0x0941: "u-matra",   # ु
    0x094D: "virama",    # ्  (halant -> conjuncts)
    0x0901: "candrabindu",  # ँ
    0x091C: "ja",    # ज
    0x092A: "pa",    # प
    0x0924: "ta",    # त
}


def name_of(f, name_id, default=""):
    try:
        for rec in f["name"].names:
            if rec.nameID == name_id:
                try:
                    return str(rec.toUnicode())
                except Exception:
                    return str(rec)
    except Exception:
        pass
    return default


def analyze(path):
    row = {"file": os.path.basename(path), "bytes": os.path.getsize(path)}
    try:
        f = TTFont(path, lazy=True)
    except Exception as e:
        row["error"] = f"{type(e).__name__}: {str(e)[:60]}"
        return row

    row["family"] = name_of(f, 1, "?")
    row["version"] = name_of(f, 5)
    lic = name_of(f, 13, "") or name_of(f, 14, "")
    row["license"] = lic[:48]

    try:
        row["sfnt"] = repr(f.sfntVersion)
    except Exception:
        row["sfnt"] = "?"

    cov = set()
    if "cmap" in f:
        for t in f["cmap"].tables:
            cov.update(t.cmap.keys())
    row["deva"] = sum(1 for c in DEVA if c in cov)
    row["latin"] = sum(1 for c in LATIN if c in cov)
    row["missing_core"] = [v for c, v in CORE.items() if c not in cov]
    row["gsub"] = "GSUB" in f
    row["gpos"] = "GPOS" in f

    # Verdict
    if row["deva"] >= 90 and row["gsub"]:
        row["verdict"] = "UNICODE-OK"
    elif row["deva"] >= 90:
        row["verdict"] = "UNICODE-NO-SHAPING"
    elif row["latin"] >= 90 and not row["gsub"]:
        row["verdict"] = "LEGACY"
    else:
        row["verdict"] = "OTHER"
    return row


def main():
    paths = []
    for a in sys.argv[1:]:
        if os.path.isdir(a):
            for ext in ("*.ttf", "*.otf", "*.TTF", "*.OTF"):
                paths.extend(glob.glob(os.path.join(a, ext)))
        else:
            paths.extend(glob.glob(a))

    seen, uniq = set(), []
    for p in paths:
        k = os.path.basename(p).lower()
        if k not in seen:
            seen.add(k)
            uniq.append(p)

    rows = [analyze(p) for p in uniq]
    rows.sort(key=lambda r: (r.get("verdict", ""), r["file"].lower()))

    hdr = f"{'verdict':<18} {'family':<24} {'deva':>4} {'lat':>4} {'GS':>3} {'GP':>3}  {'file'}"
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        if "error" in r:
            print(f"{'ERROR':<18} {r['file']:<24} {r['error']}")
            continue
        gs = "Y" if r["gsub"] else "."
        gp = "Y" if r["gpos"] else "."
        print(
            f"{r['verdict']:<18} {r['family'][:24]:<24} {r['deva']:>4} "
            f"{r['latin']:>4} {gs:>3} {gp:>3}  {r['file']}"
        )
        if r["missing_core"]:
            print(f"{'':>18} missing core: {', '.join(r['missing_core'])}")
        if r["license"]:
            print(f"{'':>18} license: {r['license']}")


if __name__ == "__main__":
    main()
