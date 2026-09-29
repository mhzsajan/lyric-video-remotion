# AGENTS.md — lyric-video-remotion

Orientation for humans and AI agents continuing work in this repo.

## What this is

A Remotion pipeline that turns `song.mp3 + lyrics.lrc` into a **1920x1080@30
H.264 mp4 lyric overlay — white text on pure black, ~12 KB/s, no audio** — for
layering over a Videosync2 camera feed in Ableton Live. Timing comes from
[Song Timer](https://github.com/mhzsajan/songtimer); the `.lrc` is the single
source of truth, shared with AbleSet/Ableton.

**mp4 cannot carry an alpha channel, and that is fine** — see
"Transparency: what mp4 can and cannot do" below. The black background is keyed
away by the **Add** or **Screen** layer blend in Videosync2, which is exactly
what the reference video does (it is `yuvj420p`, no alpha either).

`--format mov` still exists for genuine alpha (ProRes 4444) and costs ~3 GB per
song. Only reach for it if the host cannot do blend modes.

Run everything from the repo root on Windows. Source media lives in
`D:\DB Project\Text Only Lyric Video Final\Final\<Song>\` (audio + `*.lrc`).

## Requirements

| Needed for | Must have | Notes |
|---|---|---|
| Any render | Node 16+ (tested on 24.18) | `Intl.Segmenter` needs 16+; there is a fallback, but don't rely on it |
| **`--legacy-font`, i.e. every real render** | **Python 3 on PATH** | `render.mjs` transcodes via `scripts/lrc_legacy.py`. It probes `python`, then `py`, then `python3`, and if none work it stops with an explanation instead of crashing |
| The measurement/verification scripts | `ffmpeg` + `ffprobe` on PATH, `pillow`, `fonttools` | Not needed to *render* — Remotion bundles its own ffmpeg |
| Font survey | `fonttools` | `python scripts/font_survey.py <folder>` |

Verified working: Node v24.18.0, Python 3.14.6, fontTools 4.65.0, Pillow 12.3.0.

> The transcoder is Python and there is no JS equivalent, by choice: it is a
> generate-and-verify encoder (several candidate orderings, each round-trip
> decoded and compared) that is already proven word-by-word. Porting it would
> put ~250 untested lines on the path that produces the deliverable.
> `pythonCommand()` in `render.mjs` probes for an interpreter and degrades with
> a readable message rather than a raw ENOENT.

## Making a new song — the whole procedure

No setup step, no config to edit. One command per song, **on a single line**
(these run in PowerShell, where `^` and `\` line-continuations are a syntax
error — a multi-line form will simply fail to parse):

```powershell
cd C:\Users\o0o\tools\lyric-video-remotion
node render.mjs "D:\DB Project\Text Only Lyric Video Final\Final\<Song>\<audio>.mp3" "D:\DB Project\Text Only Lyric Video Final\Final\<Song>\<lrc>" --no-audio --legacy-font Abhinav.TTF --mode roam --word-anim karaoke --letter-anim pop --letter-var 0.03 --out "out\<Song> letter.mp4"
```

**The `.lrc` filename does not always match the song name.** Allare's is
`Allare Timmed.lrc`, not `Allare.lrc`. `Get-ChildItem "…\Final\<Song>" -Filter *.lrc`
to get the real name before rendering.

- **Font:** always `--legacy-font Abhinav.TTF`. Bare `--font` does **nothing**
  for these fonts (gotcha #6). `render.mjs` finds the file in `01 Fonts` one
  level up from the song folder — pass a bare filename, not a path.
- **Output:** lands in `out\` (gitignored).
- **Deliverable:** copy to
  `D:\DB Project\Text Only Lyric Video Final\Final\<Song>\<Song> - Text Only.mp4`
  once checked — that is the naming the existing files use.
- **Before shipping:** run `--report-only` (instant, no render) to confirm the
  cue count, and inspect one extracted frame. Wrong fonts have shipped twice in
  this project; the check costs seconds.

> **Run `--report-only` WITHOUT `--legacy-font` to read the lyrics.** Console
> output is deliberately ASCII-only (Windows mojibake), and `--legacy-font`
> transcodes the text to Preeti keys *before* the report prints, so you get
> `cfxf===` instead of `आहा...`. The cue count and timings are correct either
> way; only the readable-text check needs the flag left off.

`--preview` renders quarter-size at 15 fps in about a minute. Use it to check
the look, then re-render without it — **it is not the deliverable**.

**Defaults if you pass nothing:** `--size-mode word --size-var 0.15
--word-anim off --letter-anim off --letter-var 0 --mode center --size 104`.
The command above is the intended house style, which is *not* the defaults.

## Commands

```bash
npm install                                     # once
node render.mjs <audio> <lrc> --report-only     # cue list, no render
node render.mjs <audio> <lrc> --preview         # fast, low-res, for checking look only
node render.mjs <audio> <lrc> --no-audio --out "out/X.mp4"
node render.mjs --batch <dir>                   # every audio+lrc pair in a folder
npm run studio                                  # Remotion Studio
```

`--no-audio` = text-only overlay, no audio stream in the output (verified via
ffprobe: exactly one video stream). Default final is **.mp4** (h264 crf 17,
yuv420p, JPEG frames, 30fps, black background — blend Add/Screen in
Videosync2); `--format mov` switches to `--codec=prores --prores-profile=4444
--pixel-format=yuva444p10le` for true alpha, which must stay PNG-frame.

**Frame rate:** pass `--fps` to **render.mjs** (`--fps=60`) and it is forwarded
as a composition prop. Do **not** pass `--fps` to the Remotion CLI directly
(`npx remotion render …`) — that clamps the frame count and the metadata then
overrides the prop. `package.json` has no `engines` field; Node 16+ is the real
floor because `src/letters.js` uses `Intl.Segmenter`.

## Architecture

```
render.mjs            CLI. Parses args, prints the cue report, writes
                      src/lyrics.generated.js (LRC text + AUDIO_FILE) and
                      copies the audio into public/, then shells out to
                      the Remotion CLI with codec/props flags.
src/Root.jsx          <Composition id="LyricOverlay">. Duration = audio
                      length (probed) vs last cue, whichever is longer.
                      Style knobs travel as PROPS, not env vars (see gotchas).
src/LyricOverlay.jsx  Pure function of frame -> text state. cueStyle(),
                      wordState(), letterState() are exported for reuse
                      without React. cue = last stamp <= t; previous line
                      drifts up and away.
src/animations.js     styleFor() / sizeFor() / jitterFor() / positionFor():
                      deterministic per-line and per-word choices, so
                      re-renders reproduce byte-for-byte.
src/word-timing.js    wordTimings(cue, {anchors}): derives per-word times
                      from a line-level cue. The beat-sync seam.
src/letters.js        splitGraphemes() via Intl.Segmenter, letterSizePct(),
                      LETTER_SIZE_CAP = 0.03 (the measured shirorekha limit).
src/parse-lrc.mjs     LRC -> cues {time, end, text}. Handles [mm:ss.xx]
                      repeated stamps on one line (chorus expansion).
```

**Docs**

| File | What |
|---|---|
| `docs/PLAYBOOK.md` | why Remotion, what actually made rendering fast (and what did not), animation guidance, Remotion-only traps |
| `docs/REFERENCE.md` | everything measured off the target video, and the gaps vs ours |
| `docs/FONTS.md` | the 15 legacy `01 Fonts` vs 9 Unicode fonts that need no transcoding |

**Scripts** — all rerunnable; prefer these over re-deriving anything by hand

| Script | What it proves |
|---|---|
| `scripts/lrc_legacy.py` | Unicode → Preeti key transcoding for `--legacy-font` |
| `scripts/font_survey.py <folder>` | which fonts actually have Devanagari + GSUB/GPOS |
| `scripts/reference_survey.py <a> [b]` | encode recipe, background purity, roam extent, line heights, glow curve |
| `scripts/check_word_timing.mjs [lrc]` | word ordering, bounds, reassembly, beat-anchor clamping |
| `scripts/check_letters.mjs [lrc]` | grapheme cases (`क्ष`, `नि`), lossless round-trip, size clamp |
| `scripts/layout_encoder.py` | per-layout encoder, verified against `npttf2utf` |

`src/lyrics.generated.js`, `public/`, `out/` are all gitignored — they are
render inputs/outputs, not source.

## Random font size

Every line can carry a different text size, seeded like everything else.

```bash
--size-mode word      # vary each word of a line   (default)
--size-mode phrase    # vary the whole line once
--size-mode off       # flat size, the old behaviour
--size-var 0.15       # max deviation from 1.0; range 0..0.45, default 0.15
```

`--size-var 0.15` means 85%..115% of `--size` (default 104px). It is **clamped
to 0.45 in render.mjs** on purpose: past that the small words stop being
readable at 1080p and the big ones hit the frame edge, which is the opposite
of the intent. If a render needs more drama, change `--seed` instead.

Where it lives, in case it needs extending:

| File | What |
|---|---|
| `src/animations.js` → `sizeFor(seed, index, amount, salt)` | seeded multiplier in `[1-amount, 1+amount]` |
| `src/LyricOverlay.jsx` → `wordSpans()` / `planSize()` | turns that into spans |
| `src/Root.jsx` `defaultProps` | `sizeMode: "word"`, `sizeVar: 0.15` |
| `render.mjs` | parses and validates both flags |

Two invariants worth preserving:

- **Word multipliers are `%` of the parent, not pixels** — the outgoing line
  renders at 0.62 (center) / 0.8 (roam) of the current size, and pixel-sized
  words would escape that shrink.
- **Seeded, never `Math.random`** — keyed on `(seed, cueIndex, "w"+wordIndex)`
  so a re-render of the show file is byte-identical.

Verified on a full 1920x1080 render of Allare: baseline flat, shirorekha
unbroken, no overflow.

## The reference look

`docs/REFERENCE.md` records what was measured off the user's target file,
`Perfect Example/ritu-whisper.mp4`, and how our output compares. Short version:

- **The encode recipe already matches** — mp4 / h264 / `yuvj420p` / 1920x1080 /
  30 fps / no audio / pure black, at ~12 KB/s. Song length barely matters: a
  7-minute song is ~5 MiB. The multi-gigabyte files in this project came from
  choosing ProRes, from nothing else.
- **The reference has no alpha channel either.** Its "transparent background"
  is black + Add/Screen blend, same assumption our mp4 makes.
- **Still missing versus the reference:** head and tail title cards, and a white
  halo on *every* line. `glow` exists but is one style in the animation pool,
  so most lines get the default dark shadow and a hard edge. (Wrapping to two
  lines is *not* missing — roam mode's `maxWidth: 60vw` already does it,
  measured 2 lit bands on Allare's longest cue. The reference simply wraps
  earlier and more often.)
- **Size:** reference line height is 1.20–1.29x ours, so a matching `--size`
  is roughly 125–134, not 104.
- **Never use it for timing** — its cue times are ASR-derived and disagree with
  the `.lrc`. Timing comes from Song Timer and nowhere else.

Re-measure any file (and A/B it against ours) with:

```bash
python scripts/reference_survey.py <video>            # one file
python scripts/reference_survey.py <reference> <ours> # A/B + suggested --size
```

## Word-by-word animation

```bash
--word-anim off        # whole-line animation, the old behaviour (default)
--word-anim reveal     # each word rises into place as it arrives
--word-anim karaoke    # newest word is brightest, settling back after
--word-anim pulse      # small scale pop as each word lands
```

Each word of a cue is scheduled across that cue's `[time, end)` span and
animates as it arrives. Already-sung words **stay visible** — the audience has
to be able to read the line while the next one is coming in.

**The `.lrc` is not touched.** It is a contract shared with AbleSet and Ableton
and carries one timestamp per line. Word times are derived at render time in
`src/word-timing.js`, which divides a cue's span among its words in proportion
to sung character count (trailing punctuation excluded, so `नगर,` does not
outlast `नगर`).

This is an approximation: it assumes a line is sung evenly, so individual words
will not land exactly on the sung syllable. It needs no new input and no
dependencies, and it reads correctly.

**The seam for beat sync** is `wordTimings(cue, { anchors })` — pass absolute
times and words snap to them, out-of-order anchors clamped forward so words
can never render backwards. Beat detection is meant to plug in here without
touching anything else in the renderer.

| File | What |
|---|---|
| `src/word-timing.js` | `wordTimings()` / `splitWords()` / `wordWeight()` — pure, no React |
| `src/LyricOverlay.jsx` | `wordState()` per mode, `animatedWords()` renders the spans |
| `scripts/check_word_timing.mjs` | asserts ordering, bounds, reassembly, anchors |

`node scripts/check_word_timing.mjs [lrc]` runs those assertions against a real
song's cues (109/109 for Allare). It exists because a word popping out of order
mid-render is painful to spot by eye in a four-minute video.

## Per-letter animation and size

```bash
--letter-anim fade|rise|pop|wipe   # per-letter animation  (default off)
--letter-var 0..0.03               # per-letter SIZE       (default 0 = off)
```

A second animated layer nested **inside** each word span, so it works with or
without `--word-anim`. `--letter-anim` is safe at any strength; `--letter-var`
is capped hard at **0.03**.

**Letters are grapheme clusters, not codepoints** (`src/letters.js`,
`Intl.Segmenter`). `क्ष` is three codepoints forming one glyph, and `नि` stores
its pre-base matra *after* the consonant though it draws to the left. Splitting
on codepoints mangles both. `node scripts/check_letters.mjs` covers the known
cases plus a lossless round-trip over every cue in a song.

**Why the size cap is so low — measured, not guessed.** Rendering one settled
line at five values and reading the headline at 3× zoom:

| `--letter-var` | What `हावा` looks like |
|---|---|
| `0` | one continuous bar (control) |
| **`0.03`** | **bar continuous, letters differ subtly** — the cap |
| `0.05` | bar starts to separate |
| `0.08` | bar clearly broken into segments |
| `0.12` | badly broken, the word reads as *damaged* |

The first guess here was 0.12 and it was plainly wrong. The shirorekha is the
strongest horizontal feature in a Devanagari glyph, so it is the first thing
the eye catches when it steps, and 0.05 is already enough to look like a
mistake. This is a property of the script — any typesetter that lets you size
two letters of a Devanagari word differently breaks it the same way, which is
why **size is per-word** and animation can safely be per-letter.

> Gotcha #8 says size is per WORD, never per letter. That is still the rule —
> the letter layer can only reach 0.03, which is the measured point at which
> the headline starts to look broken.

## Transparency: what mp4 can and cannot do

**mp4/H.264 cannot carry an alpha channel. Not a settings problem — a format
limit.** Do not spend time looking for a flag. These were all actually tried,
not assumed:

| Attempt | Result |
|---|---|
| h265 in mp4, `yuva420p` | `Loaded libx265 does not support alpha layer encoding` |
| VP9 in webm via ffmpeg (hand-built) | alpha plane decodes flat opaque |
| VP9 in webm via Remotion | `alpha_mode=1` tag is set — **but the alpha plane is flat 255, every pixel opaque** |
| Real alpha PNG → VP9 | alpha lost |

The VP9 case is the nastiest because it *looks* like it worked: ffprobe reports
`TAG:alpha_mode=1` and the file is the right size on disk. Decoding it to PNG
and sampling a pixel is the only way to catch it.

**The file size question and the alpha question are the same question.** Text on
black compresses to roughly 12 KB/s regardless of song length — a 7-minute song
is ~5 MiB. The 3.2 GB `Allare - Text Only.mov` was purely `--format mov`
(ProRes 4444 stores full RGBA every frame). Nothing about the content forced it.

**So: black background + Add/Screen blend is the answer, not a compromise.**
That is what the reference video does — `ritu-whisper.mp4` is `yuvj420p` with
no alpha channel at all. Keep the background at pure `#000000`; any lift leaves
a grey rectangle over the camera feed. `scripts/reference_survey.py` checks
`background worst corner sum(RGB) = 0` on any file.

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
5. **The `--preview` length cap lives in `calculateMetadata`, not on the
   command line.** It used to be `--frames=0-<lastCue+2s>`, computed from a
   different number than the composition's own duration
   (`max(audio, lastCue)`), so on any song whose audio is shorter than its
   last cue plus 2s the range ran past the end and Remotion refused:
   *"durationInFrames ... 6257, but frame range 0-6259"*. Allare is exactly
   that case (417.0 s audio, 415.3 s last cue). One place now owns the
   length, via the `preview` prop. **Never reintroduce a `--frames` range
   for preview** — it will disagree again.
6. **`--legacy-font` needs `npttf2utf` installed, and without it the failure
   is a bare `FileNotFoundError` on `map.json`.** `scripts/layout_encoder.py`
   loads its five layouts from that file. `pip install npttf2utf` is not
   optional; every real render goes through it. Check with
   `py -c "import npttf2utf"`.
7. **Nepali `01 Fonts` (AMS/Ananda/Abhinav) are legacy ASCII-mapped fonts** —
   0 Devanagari codepoints, no GSUB/GPOS, so `--font "AMS Manthan"` alone does
   NOTHING: Chromium falls back per character. The working path is
   `--legacy-font <file>`, which transcodes the lyrics into the font's own key
   layout and registers the .ttf through FontFace.
   **But prefer a Unicode font.** `--font "Nirmala UI"` has none of these
   problems and needs nothing installed. Track B is only for a specific
   classic look, and it does not work for most lyrics: measured on two songs,
   **34 of 110 words** need a character (`्` virama, `ँ` candrabindu, `ञ`)
   that a generated layout cannot encode, and those characters reach the font
   unmapped so Chromium draws them in a *different* font — which is what makes
   a word look like it has a stray `0` or `O` in it.
   Never assume Abhinav's Preeti layout generalises: it is a property of the
   layout that `npttf2utf` covers, not of the renderer. See **docs/FONTS.md**
   and `scripts/passthrough.py`.
8. **Random size is per WORD by default, never per letter.** Devanagari's
   shirorekha (the headline bar) is continuous inside a word — two letters at
   different sizes snap it in half. Word boundaries are already gaps, so they
   are safe. The `--letter-var` layer can only reach **0.03** for exactly this
   reason; see "Per-letter animation and size" above for the measured table.
9. **Measuring the shirorekha by top-of-glyph is invalid.** Comparing the
   topmost lit row per column looks like it measures headline flatness, but
   Devanagari matras (`ि`, `ँ`, `ौ`) legitimately rise *above* the headline,
   so the metric reports "stepped" even at `--letter-var 0` where the bar is
   provably intact. It was used to produce a wrong conclusion here. Judge the
   headline by eye at 3× zoom, or measure a region with no matras.
10. **`--hardware-acceleration` is ignored whenever `--crf` is set.** Remotion
   prints `"crf" option is not supported with hardware acceleration` and
   encodes in software. The flag was on every render here until this was
   found; it did nothing on any hardware. Removed. It is also NVENC-only, so
   it would not help on AMD regardless.
11. **Remotion's bundled ffmpeg is not system ffmpeg** — no `rawvideo` muxer,
    no `signalstats`. Verification tricks against the bundled binary silently
    produce nothing. Use system ffmpeg to measure.
12. **CSS `transform` is one property — the last write wins.** In roam mode the
    entrance/exit animation (a `scale()` for glow) was applied to the same div
    carrying the position `translate(-50%,-50%)`, so the animation *replaced*
    the positioning and the block hung off the frame edge. Fixed by splitting
    them: outer div owns position, inner `inline-block` div owns the animation.
    Easy to reintroduce whenever a new style adds a transform.
13. **A randomized position needs a safe band derived from block size, not
    taste.** Roam centers a block on a seeded anchor with `maxWidth: 60vw`, so
    the anchor must sit within `[maxW/2, 100-maxW/2]` horizontally and
    `[maxH/2, 100-maxH/2]` vertically, or a full-width block clips. That is why
    the bands are **x 32–68 %, y 24–66 %** (`positionFor`). The first range
    (x 12–52 %, y 8–66 %) was chosen by eyeballing the reference and shipped a
    latent bug that only showed on one song: Ritu's long chorus lines lost
    100–145 px off the left edge, and a held two-line block pushed 1000+ px of
    glow through the top. Kali Kali had rendered "clean" purely because its seed
    got lucky.
14. **A `--no-audio` render with no `--length` ends where the last LYRIC ends,
    not where the song does.** The composition cannot probe an audio it does
    not have, so the length falls back to the last cue — and a `.lrc` records
    only when a line *begins*, so that end is an estimate from the next line.
    Measured: Kali Kali is 6:49.1 of audio, its last lyric ends at 5:47.5, and
    the render stopped at 5:49.5 — the overlay ended while the song was still
    playing. Pass `--length <seconds>` for every `--no-audio` render.
15. **A render that finishes is not a render that is correct — verify the
    file, not the exit code.** `--mode roam` dropped the `<Audio>` element
    entirely: the component's early return for roam had no `<Audio>`, only the
    centre path did. So *every* roam render came out **silent** while exiting
    0, printing `OK`, at the right length, the right size, with a
    plausible-looking picture. Nothing in the output says "no audio", and
    `--mode roam` is the recommended style, so this was the default path.

    Caught only by looking at the stream list:

    ```
    ffprobe -v error -show_entries stream=codec_type -of csv=p=0 out/x.mp4
    roam   -> 0,h264,video
    centre -> 0,h264,video
              1,aac,audio
    ```

    `scripts/check_output.py` does that plus the length and the black-plate
    check, and fails loudly:

    ```bash
    py scripts/check_output.py out/"<song>.mp4"
    py scripts/check_output.py --no-audio --audio-seconds 409.13 out/"<song>.mp4"
    ```

    It needs `pillow` for the background-purity sample. Run it before
    delivering anything. **Any new early return in a component has to carry
    every side element the other paths carry** — an `<Audio>`, a `<Sequence>`,
    a provider. That is the shape of this bug.
16. **Verify the finished video, not the stills you grabbed while building.**
    A latent edge-clip can survive every spot check. Scan the whole file for
    content in the outer rows/columns —
    `ffmpeg -i out/X.mp4 -vf "fps=1/6,cropdetect=limit=0.04" -f null -` finds
    every instance in seconds. Both songs rescanned 100 % clean after the
    anchor fix.
17. **`gh repo create --source . --push` fails if the remote already exists**
    (`GraphQL: Name already exists`). Check `git remote -v` first and just
    push. Transient `Failed to connect to github.com:443` also happens here —
    retry.

## The shape of the roam audio bug, in one line

A component with **two** return paths will eventually have a side element in
only one of them, and the path that misses it is whichever one a later style
flag selects. `--mode roam` is the recommended style, so the broken path was
also the default one. When you add a branch here, diff it against the others
for anything that is not a style: `<Audio>`, a provider, a `<Sequence>`.

## Measuring video: traps that produce confidently wrong numbers

Both of these produced numbers that looked reasonable and were wrong. Check
before trusting any figure about a render.

- **`cropdetect` with `reset=0` accumulates — it is a UNION, not per frame.**
  `crop=…` is the running bounding box of everything seen so far, not the
  current frame. It answers "what area does text ever occupy in this file",
  which is useful, but reading it as a per-frame margin is wrong. It briefly
  suggested 97.5% of frames touched a screen edge; that number was an artefact
  of the union and of a render that predated the roam fix (`633b82b`).
  Drop `reset=0` for per-frame boxes — it is then far slower.
- **Pick a timestamp inside a cue, not near its end.** A cue is short; sampling
  0.3 s after its last word gives a blank frame, and it looks like "no text
  here". Scan a range first (cropdetect or a few `lit px` samples) to find where
  the text actually is.

## Shell/CLI traps on this machine (Windows, PowerShell)

- **PowerShell reports successful `git`/`gh` as `NativeCommandError` with exit
  code 1.** It prints git's stderr as an error record. Judge by the output
  lines (`633b82b..8794c33  main -> main`), never by `$LASTEXITCODE`.
- **Inline JSON in a command line breaks.** `--props='{"background":"transparent"}'`
  fails with a JSON parse error. Write the props to a file and pass
  `--props=path.json` (a BOM breaks it too — write it with Python or
  `Set-Content -Encoding UTF8` and verify).
- **Unescaped `|` inside a PowerShell `Select-String -Pattern`** is read as a
  pipeline and floods the output with parameter errors.
- **`render.mjs --frames N` does not limit the render** — it renders the whole
  composition. For a single frame use `npx remotion still`.
- **ffmpeg's `color=c=black@0.0` does not produce an alpha channel.** To build
  a real transparent test image, write a PNG with Pillow instead.

## Render state

**Proven and current** — `out/Allare letter.mp4`, 6.4 MiB, 417s, 1920x1080@30,
h264, pure black, no audio, Abhinav, roam + word-by-word karaoke + per-letter
pop. Verified: 109 cues, conjuncts and matras intact, shirorekha continuous at
the capped size, text stays inside frame. This is the reference output for the
current house style.

`out/Allare wordanim.mp4` (6.1 MiB) is the same without the letter layer.

**Delivered deliverables, all needing replacement:**

| File | Problem |
|---|---|
| `Final\Allare\Allare - Text Only.mov` | 3.2 GB ProRes. Fonts correct (35/35 lines round-tripped). Re-render as mp4. |
| `Final\Ritu\Ritu - Text Only.mp4` | **Verified wrong text**: at t=145 s it shows text matching no cue in `Ritu.lrc`. Our render correctly shows `सजिलै माया पाउन,` (the cue at 144.17 s). |
| `Final\Kali Kali\Kali Kali - Text Only.mp4` | User reports wrong fonts. **Not independently verified.** |

**Never delivered through `--legacy-font`:** Kali Kali, Ritu. Allare is the only
song proven end to end. Run `--report-only` and inspect a frame before shipping
either.

**Not yet implemented** (all measured, see `docs/REFERENCE.md`): head and tail
title cards, a white halo on *every* line (`glow` is one style in the pool, so
most lines keep the default dark shadow). Wrapping to two lines already happens
naturally via `maxWidth: 60vw` in roam mode — measured 2 lit bands on Allare's
longest cue.

**Next up:** beat sync, via the `wordTimings(cue, { anchors })` seam.

## Hygiene

- Never commit `out/` (GB-scale ProRes), `demo/`, `public/`, or
  `src/lyrics.generated.js`.
- Console output in render.mjs is ASCII-only on purpose (Windows mojibake).
