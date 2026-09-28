# AGENTS.md — lyric-video-remotion

Orientation for humans and AI agents continuing work in this repo.

## What this is

A Remotion pipeline that turns `song.mp3 + lyrics.lrc` into a **1920x1080@60
ProRes 4444 (alpha) lyric overlay** for layering over a Videosync2 camera feed
in Ableton Live. Timing comes from [Song Timer](https://github.com/mhzsajan/songtimer)
— the `.lrc` is the single source of truth, shared with AbleSet/Ableton.

Run everything from the repo root on Windows (bash). Source media lives in
`D:\DB Project\Text Only Lyric Video Final\Final\<Song>\` (audio + `*.lrc`).
Nepali/Devanagari fonts from that folder's `01 Fonts` are installed system-wide.

## Commands

```bash
npm install                                     # once
node render.mjs <audio> <lrc> --report-only     # cue list, no render
node render.mjs <audio> <lrc> --preview         # fast, low-res, no alpha
node render.mjs <audio> <lrc> --no-audio --out "out/X.mp4"
node render.mjs --batch <dir>                   # every audio+lrc pair in a folder
npm run studio                                  # Remotion Studio
```

`--no-audio` = text-only overlay, no audio stream in the output (verified via
ffprobe: exactly one video stream). Default final is **.mp4** (h264 crf 17,
yuv420p, JPEG frames, 30fps, black background — blend Add/Screen in
Videosync2); `--format mov` switches to `--codec=prores --prores-profile=4444
--pixel-format=yuva444p10le` for true alpha, which must stay PNG-frame.
Never pass the CLI `--fps` flag — it clamps the frame count; fps goes via
props (`--fps=60` on render.mjs is safe).

## Architecture

```
render.mjs            CLI. Parses args, prints the cue report, writes
                      src/lyrics.generated.js (LRC text + AUDIO_FILE) and
                      copies the audio into public/, then shells out to
                      the Remotion CLI with codec/props flags.
src/Root.jsx          <Composition id="LyricOverlay">. Duration = audio
                      length (probed) vs last cue, whichever is longer.
                      Style knobs travel as PROPS, not env vars (see gotchas).
src/LyricOverlay.jsx  Pure function of frame -> text state. cueStyle() is
                      exported for reuse without React. cue = last stamp <= t;
                      previous line drifts up and away.
src/animations.js     styleFor(seed, cueIndex, pin): deterministic per-line
                      animation choice, so re-renders are reproducible.
src/parse-lrc.mjs     LRC -> cues {time, end, text}. Handles [mm:ss.xx]
                      repeated stamps on one line (chorus expansion).
```

`src/lyrics.generated.js`, `public/`, `out/` are all gitignored — they are
render inputs/outputs, not source.

## Gotchas that cost us time (do not rediscover these)

1. **process.env in components is statically replaced at build time.** An
   unset var becomes the literal string `"undefined"` (truthy!) — style props
   must arrive as composition PROPS. Only plain numbers are safe from env.
2. **Global /g regex + string slicing bug in parse-lrc**: a `TIME_RE.exec`
   loop kept `lastIndex` in the original string's coordinates, so every
   timestamp after the first was glued to the visible text and dropped.
   Current parser slices `rest` and re-matches an anchored regex per stamp.
3. **Hand-timed LRCs have huge unstamped gaps** (instrumentals). Cues are
   capped at HOLD_SECONDS (8s) so lines don't freeze on screen for a minute.
4. **remotion.config.js must not pin codec/ProRes profile** — the composition
   declares defaults and render.mjs passes per-mode flags; pinning globally
   breaks `--codec=h264` previews with a conflict error.
5. **`--preview` caps frames at last cue +2s** — otherwise it renders the
   whole 417s timeline at 15fps, mostly silence.
6. **Nepali "AMS/Ananda" fonts are legacy ASCII-mapped fonts** — see Font
   section in README. `--font "AMS Manthan"` currently has NO effect on
   Devanagari text: Chromium silently falls back to Nirmala UI per character
   because the font's Unicode cmap covers ASCII only. Verified by rendering
   identical frames with "AMS Manthan" vs "Nirmala UI" pinned.

## Render state

- 2026-09-28: **Allare** delivered (text-only, no audio) →
  `D:\DB Project\Text Only Lyric Video Final\Final\Allare\Allare - Text Only.mov`
  (3.2 GB, 417s, alpha verified with alphaextract: silent sections = 0.0).
- Pending: **Kali Kali**, **Ritu** (same folder, same one-command flow).
- `out/demo.mov` was the first end-to-end proof (with audio embedded).

## Hygiene

- Never commit `out/` (GB-scale ProRes), `demo/`, `public/`, or
  `src/lyrics.generated.js`.
- Console output in render.mjs is ASCII-only on purpose (Windows mojibake).
