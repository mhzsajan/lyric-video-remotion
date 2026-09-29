# Fonts in the renderer

**This repo renders video. It does not make fonts.** Key layouts, the font
catalogue, the tier table and the tooling that decides whether a font can write
a given song all live in
[mhzsajan/nepali-legacy-fonts](https://github.com/mhzsajan/nepali-legacy-fonts).

What follows is only what you need *at render time*.

## Pick one of three paths

| | Use | Risk of a wrong letter |
|---|---|---|
| **Unicode** | `--font-file <ttf>` or `--font "<Family>"` | **None.** Native codepoints, no conversion. |
| **Legacy** | `--font-slug <slug>` or `--legacy-font` | Real. Check the song first — see below. |
| **Default stack** | neither flag | Silent. See "the flag that looks ignored". |

Reach for a Unicode font unless the typeface specifically matters — that is the
**Tier A** answer when someone asks for a font that just works, and the only
tier where a wrong character is impossible. The 58 Unicode faces are listed in
the font repo's README; `out/contact-sheet.png` here renders 15 of them side by
side. Tiers B and C are verified but carry the five known gaps below.

```bash
# any .ttf, used exactly as it is
node render.mjs song.mp3 song.lrc --font-file C:\path\YantraManav-Black.ttf
```

No layout, no transcoding, no Python. The family name is read from the font
file, so you do not pass `--font` as well.

## `--font-slug`: font and layout together

A slug names a directory in the font repo. It resolves the `.ttf` *and* its
generated layout, which is the whole point — a `.ttf` without its layout silently
falls back to the Preeti-era map and renders that font's words wrong.

The font repo ships **79 verified layouts** and a 42-font preferred list. Check
there before generating one.

```bash
node render.mjs song.mp3 song.lrc --font-slug ams-manthan
```

The repo is looked for as a sibling directory named `nepali-legacy-fonts`, or
given explicitly:

```bash
node render.mjs song.mp3 song.lrc --font-slug ams-manthan --fonts-repo C:\tools\nepali-legacy-fonts
```

Both the layout and the font file must exist. A missing layout is a hard error
rather than a fallback, and the message says which of the two is absent.

**Why layouts are no longer vendored here.** They used to be, and the copy went
stale in exactly the way you would expect: it still carried the pre-fix i-matra
encoding, so `ि` produced a stray KA and `रिसले` rendered as `किस्तो`. A
vendored layout is a copy that can be out of date with no warning, so there is
now exactly one. If you see that failure anywhere, the layout is old — not the
renderer.

## Before you render a legacy font: check the song

A legacy font that passes every check may still be unable to write your song.
AMS Manthan is verified end to end and cannot write Allare: 15 of 35 lines
contain a character aNepali publishes no key for, so they are dropped or fall
back to another typeface mid-word, silently.

```bash
py ..\nepali-legacy-fonts\scripts\check_song.py --font ams-manthan song.lrc
```

Exit 1 means do not render this song in this font. The font repo's
[docs/SONG-CHECK.md](https://github.com/mhzsajan/nepali-legacy-fonts/blob/main/docs/SONG-CHECK.md)
explains why nothing downstream catches it — a wrong letter is not a malformed
file, so the render exits 0, is the right length, has a clean background and
passes every output check there is.

## The flag that looks ignored

`--font` takes a *family name*, and a name that does not resolve does not error.
The CSS family simply does not match, the browser falls through to the system
font, and the output looks like you passed nothing. This is why:

- `--font-file` reads the family out of the file rather than trusting `--font`
- `--font-slug` does the same
- pass `--font` with `--font-file` only to *override*

Real disagreement seen in this project's own fonts: `Yantramanav` in the file vs
`Yantra Manav` in a README, `Halant` vs `Halant New`.

## Calibrating a new font

The renderer measures text width from the browser rather than from fontTools,
because shaping is the browser's job. If a new face wraps or clips, calibrate it:

```bash
node scripts/calibrate_width.mjs --font "<Family>" --font-file <ttf> --audio song.mp3 --lrc song.lrc --force
```

`--font-file` is required, or it silently measures the system font instead.
Check that the printed coefficients differ from the last font you calibrated.

## The two bugs that made the legacy path unusable

Neither was about fonts; both blocked everything before a font could be tried.
Both are fixed, and both are recorded here because the failure messages pointed
nowhere near the cause.

**`npttf2utf` was never a dependency.** `scripts/layout_encoder.py` reads its
five built-in layouts from the package's `map.json`. With the package absent,
every `--legacy-font` render died with `FileNotFoundError: ...\scripts\map.json`
— a message that says nothing about installing a Python package.

```bash
pip install fonttools npttf2utf pillow
```

**Every preview render crashed.** `render.mjs` passed
`--frames=0-<lastCue + 2s>`, computed from a different number than the
composition's own duration, which `calculateMetadata` derives from
`max(audio length, last cue)`. Whenever a song's audio is shorter than its last
cue plus two seconds the range ran past the end:

```
Error: The "durationInFrames" of the <Composition /> was evaluated to be
6257, but frame range 0-6259 is not within the frame range of the
composition (0-6256).
```

Allare is exactly that case — 417.0 s of audio against a 415.3 s last cue. The
cap now lives in `calculateMetadata`, so one place owns the length and the two
cannot drift apart again.

## Looking at one frame first

Step 3 of any legacy-font workflow is the one that catches a wrong font, and it
costs seconds. A wrong map does not error — it renders the wrong letters, which
is the failure that is easy to miss in a four-minute video.

```bash
node render.mjs song.mp3 song.lrc --font-slug ams-manthan --prepare-only
npx remotion still src/index.js LyricOverlay out/check.png --frame=5900 --props=out/props.json
```

`--prepare-only` transcodes and registers the font without rendering.
