# Playbook — the parts that are not in AGENTS.md

`AGENTS.md` is the orientation: what this is, how to render, what breaks.
This file is the *why* behind those choices plus the findings that only showed
up under load. Nothing here contradicts AGENTS.md; where both cover a topic,
AGENTS.md wins.

## Why Remotion

The pipeline needs four things at once: a real alpha option, programmatic
frame-accurate timing from an `.lrc`, correct Devanagari shaping, and headless
unattended runs on Windows.

| Rejected | Why |
|---|---|
| ffmpeg `drawtext` per cue | No complex shaping — conjuncts and matras break. Filter graphs become unmaintainable past ~100 timed cues. |
| Python (PIL/Pycairo) | Same shaping problem, and the whole render/encode/preview loop has to be hand-built. |
| After Effects scripting | GUI-bound, licensed, not headless-scriptable. Overkill per song. |
| HTML page + screen capture | No frame accuracy, no alpha. |
| **Remotion** | React → frames via headless Chromium (full HarfBuzz shaping), first-class alpha via PNG frames + ProRes 4444, deterministic re-renders, CLI + Studio. |

`"type": "module"` in `package.json` is **required** — without it webpack
parses the entry as CommonJS and every `import` fails with "may appear only
with sourceType: module".

## Performance: what actually mattered, and what did not

Measured on an AMD RX 9060 XT, 20-thread Ryzen laptop.

**Dead end — GPU offload.** The intuition that "CPU 100%, GPU idle" means
something is wrong is false here. `--gl=angle` (real GPU) vs `--gl=swiftshader`
(software) rendered 1000 text frames in identical time; concurrency past ~8
changed nothing. The stages that would benefit either don't apply on AMD
(NVENC-only) or don't exist in text-and-shadow content. Stop optimizing this.

**Dead code — `--hardware-acceleration`.** It is ignored whenever `--crf` is
set, and Remotion says so out loud:

```
Hardware accelerated encoding disabled - "crf" option is not supported with hardware acceleration
```

It was passed on every render here until that was found. It did nothing on any
hardware. An NVIDIA machine that genuinely wants NVENC must switch to bitrate
mode (`--video-bitrate=8M` ≈ crf-17 quality at 1080p) instead of crf — a
different quality/size trade-off, so it is not the default.

**Real wins:** JPEG frames instead of PNG on the mp4 path (~15%, 26s vs 31s per
1000 frames), and 30fps instead of 60 (halves the frame count).

**Budget:** preview ~2 min (6261 frames at 480x270p15). Final 1080p60 ProRes
4444 for a 417s song was ~17 min and 3.2 GB; the mp4 default is roughly 4×
faster and ~20× smaller. Always preview.

## Animation guidance

All animation is a pure function of the frame, seeded — a re-render of the same
song must be byte-identical, because the video has to keep matching the live
show file forever. Entrance ≤ 0.35s: lyric videos live or die on the text being
there *when sung*.

| Style | Reads as | Use for |
|---|---|---|
| `fade` | gentle | ballads, emotional lines |
| `rise` | "current", not shouting | the workhorse |
| `pop` | snappy | short punchy lines, beats |
| `slide-left` / `slide-right` | directional | alternate across sections |
| `typewriter` | spoken word | slow short lines |
| `blur-in` | dreamy | atmospheric passages |
| `zoom-through` | camera-like | big chorus entries |
| `glow` | white bloom | the reference-video look |

Do **not** use `typewriter` on lines under ~8 characters — the wipe is
unreadable. `zoom-through` on every line is exhausting by minute 3. The
default mix (`styleFor(seed, cueIndex)`) reads well across a 7-minute song;
repetition from any single style would be noticeable.

## Remotion-specific traps not covered in AGENTS.md

- **JPEG frames destroy alpha.** `--image-format=jpeg` flattens transparency to
  a black matte. PNG is mandatory for the ProRes path; JPEG is fine for mp4
  because that path is opaque anyway.
- **A single-frame render needs a directory as output.** `--frames=10480` with
  `out/x.png` errors — "the output directory of the image sequence cannot have
  an extension". Pass a **range** (`--frames=10480-10480`) and a directory.
- **Frame indexes are 0-based.** `--frames=0-N` against a composition of
  `durationInFrames = N` errors; subtract 1 from any computed end frame.
- **`npx remotion` prints `npm notice` lines to stderr** on success. Never
  parse either stream for success or failure — check that the output file
  exists and has a plausible size.
- **Remotion's bundled ffmpeg is not system ffmpeg.** It has no `rawvideo`
  muxer and no `signalstats`, so verification tricks like `alphaextract` and
  raw-gray dumps silently produce nothing if you invoke the bundled binary.
  Use system ffmpeg for measurement; use Remotion's only if system ffmpeg is
  absent.
- **A wrapper that shells out to a CLI should print the exact child argv in a
  debug mode.** `--fps=60` was once silently dropped because the parser only
  accepted `--name value` and not `--name=value`; a debug-args mode turned an
  "impossible" bug into a one-line finding. Both forms are accepted now.

## Claims that were tested and did NOT reproduce

Recorded so nobody re-chases them or "fixes" a non-bug.

- **A UTF-8 BOM does not eat the first cue here.** It was reported to do so in
  a different implementation. Tested here with a BOM-prefixed Allare `.lrc`:
  109 cues either way, and `U+FEFF` never reaches `src/lyrics.generated.js`.
  The metadata match is not line-anchored, so a leading BOM is harmless.
- **A 7-minute song at 15fps does not have to render 25k frames** — the preview
  frame cap in `render.mjs` already prevents it.

## Source media layout

`E:\01 Ablenton All Files\AI Lyrical Video Working Folder\<Song>\` holds the
audio and the lyrics. **The `.lrc` name does not always match the song**: Allare's
is `Allare Remotion.lrc`. List the folder rather than assuming `<Song>.lrc`.

Legacy `.ttf` fonts are in `E:\01 Ablenton All Files\Arranged Lyrics & Songs\Final\01 Fonts\`.
Unicode faces come from the font repo — see `docs/FONTS.md`.
