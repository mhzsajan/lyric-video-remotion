# Lyric Overlay (Remotion)

Renders a **transparent lyric-text overlay** from a `.lrc` produced by
[Song Timer](https://github.com/mhzsajan/songtimer), so you can drop lyrics onto
a Videosync2 video layer in Ableton Live without re-typesetting anything.

Output is an **.mp4 (H.264, 1920x1080 at 30 fps)**: white text on a pure
black background — in Videosync2 set the layer blend to **Add** or **Screen**
and the black disappears over your camera feed. MP4 cannot carry an alpha
channel; when you need true alpha use `--format mov` (ProRes 4444, large).
By default the song's audio is muxed in so the file syncs against its own
audio; with `--no-audio` you get a pure text-only render with no audio track
at all.

## Quick start

```bash
npm install

# 1. check the timings first — no render, instant
node render.mjs song.mp3 song.lrc --report-only

# 2. fast low-res proof (seconds, no alpha) — just to see the animation
node render.mjs song.mp3 song.lrc --preview

# 3. the real thing
node render.mjs song.mp3 song.lrc

# 3b. text-only: no audio track in the output
node render.mjs song.mp3 song.lrc --no-audio

# 3c. pin a font (must be installed system-wide)
node render.mjs song.mp3 song.lrc --no-audio --font "AMS Manthan"
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
     .als → Ableton + AbleSet                        ProRes 4444 (alpha)
                                                              │
                                                              ▼
                                                    Videosync2 video layer
```

The `.lrc` is the contract. Timing is authored **once** and consumed twice, so
Ableton and the video can never disagree.

## Options

| Flag | Meaning |
|---|---|
| `--preview` | Quarter size, 15 fps, h264, no alpha. Fast timing check. |
| `--no-audio` | Leave the audio track out: pure text overlay for layering. |
| `--font <family>` | Font family to render with (installed system-wide). |
| `--report-only` | Print the cue list and exit. No render at all. |
| `--style <name>` | Pin every line to one animation instead of mixing. |
| `--position <pos>` | `top` / `center` / `bottom` (default `center`). |
| `--size <px>` | Font size, default `104`. |
| `--size-mode <m>` | Random size per `word` (default) or per `phrase`, or `off`. |
| `--size-var <n>` | How far those sizes vary, `0`..`0.45` (default `0.15`). |
| `--color <#hex>` | Text colour, default `#ffffff`. |
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

**Always preview first.** ProRes 4444 at 1080p60 is ~29 MB for a 14-second
clip, so a four-minute song lands around 1.5 GB and takes minutes to encode.
`--preview` renders the same timing in seconds.

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

## Compositing notes

- The frame is **1920x1080 @ 60 fps** by design. If your Videosync2 project
  differs, change `WIDTH`/`HEIGHT`/`FPS` in `src/Root.jsx` **and** re-render —
  a frame-rate mismatch makes the text drift against the camera.
- Drop the `.mp4` on a video layer **above** the camera layer and set the
  layer blend to **Add** or **Screen** — black becomes transparent, no keying
  required. (A ProRes 4444 `.mov` from `--format mov` carries real alpha if
  your host reads it.)
- Without `--no-audio`, the audio is included purely for sync; mute the layer
  in the mix if the camera feed already carries sound. With `--no-audio` the
  the output has no audio stream at all — align it by ear or against the clap.
- Text sits in a soft dark halo (`--shadow` in `src/LyricOverlay.jsx`) so white
  text stays legible over a bright feed without a background plate.
