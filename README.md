# Lyric Overlay (Remotion)

Renders a **transparent lyric-text overlay** from a `.lrc` produced by
[Song Timer](https://github.com/mhzsajan/songtimer), so you can drop lyrics onto
a Videosync2 video layer in Ableton Live without re-typesetting anything.

Output is **ProRes 4444 with a real alpha channel** (1920x1080, 60 fps) with the
song's audio muxed in, so the finished `.mov` is self-contained and syncs
against its own audio.

## Quick start

```bash
npm install

# 1. check the timings first — no render, instant
node render.mjs song.mp3 song.lrc --report-only

# 2. fast low-res proof (seconds, no alpha) — just to see the animation
node render.mjs song.mp3 song.lrc --preview

# 3. the real thing
node render.mjs song.mp3 song.lrc
```

Output lands in `out/<song name>.mov`.

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
| `--report-only` | Print the cue list and exit. No render at all. |
| `--style <name>` | Pin every line to one animation instead of mixing. |
| `--position <pos>` | `top` / `center` / `bottom` (default `center`). |
| `--size <px>` | Font size, default `104`. |
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
correctly on Windows. Override with a `LYRIC_FONT` env var if you want a
different face.

## Compositing notes

- The frame is **1920x1080 @ 60 fps** by design. If your Videosync2 project
  differs, change `WIDTH`/`HEIGHT`/`FPS` in `src/Root.jsx` **and** re-render —
  a frame-rate mismatch makes the text drift against the camera.
- Drop the `.mov` on a video layer **above** the camera layer, keyed normally.
  Because the background is true alpha, no keying is required.
- The audio is included purely for sync. Mute the layer in the mix if the
  camera feed already carries sound.
- Text sits in a soft dark halo (`--shadow` in `src/LyricOverlay.jsx`) so white
  text stays legible over a bright feed without a background plate.
