# Lyric Overlay (Remotion)

Renders a **lyric-text overlay** from a `.lrc` produced by
[Song Timer](https://github.com/mhzsajan/songtimer), so you can drop lyrics onto
a Videosync2 video layer in Ableton Live without re-typesetting anything.

Output is an **.mp4 (H.264, 1920x1080 at 30 fps)**: white text on a pure black
background — in Videosync2 set the layer blend to **Add** or **Screen** and the
black disappears over your camera feed. Text on black compresses to ~12 KB/s, so
a seven-minute song is about 6 MiB.

**MP4 cannot carry an alpha channel** — a format limit, not a missing flag
(h265, VP9 and every other route were tried; see `AGENTS.md`). "Transparent"
here means *blended away*, which is exactly what the reference video does: it is
`yuvj420p` with no alpha at all. True alpha exists only via `--format mov`
(ProRes 4444) at ~3 GB per song.

By default the song's audio is muxed in so the file syncs against its own audio;
with `--no-audio` you get a pure text-only render with no audio track at all.

## Requirements

- **Node 16+** (tested on 24.18).
- **Python 3 on `PATH`** — required by `--legacy-font`, which every real render
  uses. `render.mjs` transcodes the lyrics with `scripts/lrc_legacy.py`; it
  looks for `python`, then `py`, then `python3`, and if none are present it
  stops with an explanation rather than crashing.
- `ffmpeg`/`ffprobe`, `pillow` and `fonttools` are only needed for the
  verification scripts in `scripts/`, **not** to render — Remotion bundles its
  own ffmpeg.

## The command to use

```bash
node render.mjs song.mp3 song.lrc --no-audio --legacy-font Abhinav.TTF --mode roam --word-anim karaoke --letter-anim pop --letter-var 0.03
```

(Written on one line on purpose: these run in PowerShell, where neither `^` nor
`\` continues a line — a multi-line form fails to parse.)

**`--legacy-font` is not optional for Nepali text.** The `01 Fonts` folder holds
1990s-era fonts whose Unicode tables map ASCII and nothing else, so a plain
`--font` renders *nothing useful* and Chromium falls back per character —
wrong-looking text with no error message. `--legacy-font` transcodes the lyrics
into the font's own key layout and registers the `.ttf` properly. Any older
advice to use `--font "AMS Manthan"` is a trap.

Order of work:

```bash
npm install                                  # once

# 1. check the timings — no render, instant
node render.mjs song.mp3 song.lrc --report-only

# 2. fast low-res proof (~1 min) to eyeball the look
node render.mjs song.mp3 song.lrc --legacy-font Abhinav.TTF --preview

# 3. the real thing
node render.mjs song.mp3 song.lrc --no-audio --legacy-font Abhinav.TTF --mode roam --word-anim karaoke --letter-anim pop --letter-var 0.03
```

Output lands in `out/<song name>.mp4` (or `.mov` with `--format mov`).

## Workflow

```
song.mp3 + lyrics  ──►  Song Timer  ──►  song.lrc
                                          │
              ┌───────────────────────────┴───────────────────────────┐
              │                                                       │
   ableset.com/tools/lyrics-lrc                        this renderer
              │                                                       │
              ▼                                                       ▼
     .als → Ableton + AbleSet                    H.264 mp4, white on black
              (blend Add/Screen)                        ~6 MiB, 30 fps
                                                              │
                                                              ▼
                                                    Videosync2 video layer
```

The `.lrc` is the contract. Timing is authored **once** and consumed twice, so
Ableton and the video can never disagree.

## Options

| Flag | Meaning |
|---|---|
| `--preview` | Quarter size, 15 fps, h264. Fast look check — **not a deliverable**. |
| `--no-audio` | Leave the audio track out: pure text overlay for layering. |
| `--font <family>` | Font family for **Unicode** Devanagari fonts only. Useless for the `01 Fonts` set — use `--legacy-font`. |
| `--legacy-font <f>` | **The one to use for Nepali.** Registers a Preeti-layout `.ttf` and transcodes the lyrics to match. |
| `--report-only` | Print the cue list and exit. No render at all. |
| `--style <name>` | Pin every line to one animation instead of mixing. |
| `--position <pos>` | `top` / `center` / `bottom` (default `center`). |
| `--mode <m>` | `center` (default) or `roam` — each line gets its own seeded position, the reference-video look. **Use `roam`.** |
| `--format <f>` | `mp4` (default, ~6 MiB, black bg) or `mov` (ProRes 4444, real alpha, ~3 GB). |
| `--size <px>` | Font size, default `104`. |
| `--size-mode <m>` | Random size per `word` (default) or per `phrase`, or `off`. |
| `--size-var <n>` | How far those sizes vary, `0`..`0.45` (default `0.15`). |
| `--word-anim <m>` | `off` (default), `reveal`, `karaoke` or `pulse` — animate word by word. |
| `--letter-anim <m>` | `off` (default), `fade`, `rise`, `pop`, `wipe` — animate letter by letter. |
| `--letter-var <n>` | Per-letter size, `0`..`0.03` (default `0`, off). Capped low — see below. |
| `--color <#hex>` | Text colour, default `#ffffff`. |
| `--shadow <css>` | Text shadow/halo. Default is a soft dark halo. |
| `--fps <n>` | Override frame rate. Default 30 (60 with `--format mov`). Set it to match the Videosync2 project or text drifts. |
| `--seed <text>` | Animation seed, default the `[ti:]` title. |
| `--out <file>` | Explicit output path. |
| `--batch <dir>` | Render every `name.mp3` + `name.lrc` pair in a folder. |

Animations: `fade`, `rise`, `pop`, `slide-left`, `slide-right`, `typewriter`,
`blur-in`, `zoom-through`.

## Two things worth knowing

**The animation is seeded, not random.** Each line's style comes from
`(seed, cueIndex)`, so re-rendering the same song produces a byte-identical
result. That matters live: you render once, and the video must keep matching
your show file. Change the look by changing `--seed`, not by re-rendering.

**Word-by-word animation.** `--word-anim karaoke` builds each line on screen
word by word, with the newest word brightest. The `.lrc` is untouched — word
times are derived at render time by dividing each cue's span among its words in
proportion to character count, so the file AbleSet and Ableton read stays
exactly as Song Timer wrote it. Modes: `reveal`, `karaoke`, `pulse`, or `off`
for the default whole-line animation.

**Per-letter animation, but a very small per-letter size.** `--letter-anim pop`
adds a second layer inside each word. Letters are split on **grapheme clusters**
(`Intl.Segmenter`), not characters, so `क्ष` stays one glyph and the pre-base
matra in `नि` stays attached to the left of its consonant.

`--letter-var` is capped at **0.03** and that cap is measured, not stylistic.
Devanagari's headline bar (shirorekha) runs continuously across a word, so two
letters at different sizes snap it in half. At 0.08 the bar visibly breaks into
segments; at 0.12 the word looks damaged. Animation is safe at any strength —
a letter can appear without changing size — which is why the two are separate
flags. See the table in `AGENTS.md` for all five measured values.

**Always preview first.** The one ProRes render measured end to end — Allare,
417 s at 1080p60 — came out at **3.2 GB** and took minutes to encode, roughly
8 MB per second of video. `--preview` renders the same timing in seconds. The
mp4 default costs ~12 KB/s instead, so a seven-minute song is about 5 MiB.

## Font

Defaults to `"Noto Sans Devanagari", "Nirmala UI"` so Devanagari lyrics render
correctly on Windows. Override with `--font "Family Name"` or a `LYRIC_FONT`
env var.

**Known limitation — the Nepali `01 Fonts` (AMS Manthan, AMS Aakash, Ananda
Fanko 2, ...) cannot style Devanagari in Chromium, today.** They are legacy
1990s-era fonts: their Unicode cmap maps ASCII (U+0020-U+007E) plus a handful
of symbols and nothing else, and they carry no GSUB/GPOS shaping tables.
Devanagari codepoints (U+0900-U+097F) are simply not in the font as far as a
modern browser can see, so Chromium silently falls back per-character —
verified by rendering the same frame with `--font "AMS Manthan"` and with
`"Nirmala UI"` pinned: pixel-identical output. These fonts were designed for
legacy Encoded-Nepali workflows (Preeti-like ASCII layouts), which is why they
look right in old editors but do nothing here.

**That paragraph describes the problem, not the state of the repo.** The fix
is *not* to convert the font — it is to convert the text:

```bash
node render.mjs <audio> <lrc> --legacy-font Abhinav.TTF
```

`render.mjs` transcodes the lyrics into the font's own key layout
(`scripts/lrc_legacy.py`, Preeti by default), copies the `.ttf` into
`public/fonts/`, and registers it through the FontFace API. A bare CSS
`font-family` cannot do this on its own. Verified end to end: 35/35 lines
round-tripped, rendered and inspected at 1920x1080.

Fonts that need **no** transcoding at all — nine Unicode Devanagari families
(Noto Sans/Serif, Mukta, Hind, Tiro, Yantramanav, Martel, Halant, Kalam),
each verified with fontTools for Devanagari coverage and GSUB/GPOS shaping,
all SIL OFL 1.1 and safe for broadcast — are listed in **`docs/FONTS.md`**.
`python scripts/font_survey.py <folder>` re-runs that survey on any folder.

## The target look

The file this pipeline aims at is `Perfect Example/ritu-whisper.mp4` — a
Remotion 4.0.526 render whose format our mp4 output already reproduces to
within ~1% (same codec, pixel format, resolution, frame rate, no audio, ~12
KB/s, pure black background). What it still does that we do not: head and tail
title cards, wrapping long cues onto two lines, and a white halo on every line.

All measurements are in **`docs/REFERENCE.md`**. Re-run them, or A/B a new
render against the reference, with:

```bash
python scripts/reference_survey.py <video>                # one file
python scripts/reference_survey.py <reference> <ours>     # A/B + suggested --size
```

## Compositing notes

- The frame is **1920x1080 @ 30 fps** for mp4, **@ 60 fps** for `--format mov`.
  If your Videosync2 project differs, change `WIDTH`/`HEIGHT` in
  `src/Root.jsx` **and** re-render — a frame-rate mismatch makes the text drift
  against the camera. **30 fps is the default on purpose**; it matches the
  Videosync2 source. Still unconfirmed against the actual `.als` — worth
  reading the project settings off the file.
- Drop the `.mp4` on a video layer **above** the camera layer and set the
  layer blend to **Add** or **Screen** — black becomes transparent, no keying
  required. (A ProRes 4444 `.mov` from `--format mov` carries real alpha if
  your host reads it, at ~3 GB.)
- Keep the background **exactly** black. Any lift shows as a grey rectangle over
  the camera feed. `python scripts/reference_survey.py <file>` prints
  `background worst corner sum(RGB) = 0` to confirm.
- Without `--no-audio`, the audio is included purely for sync; mute the layer
  in the mix if the camera feed already carries sound. With `--no-audio` the
  output has no audio stream at all — align it by ear or against the clap.
- Text sits in a soft dark halo (`--shadow` in `src/LyricOverlay.jsx`) so white
  text stays legible over a bright feed without a background plate.
