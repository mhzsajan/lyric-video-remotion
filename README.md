# Lyric Overlay (Remotion)

Turns a `.lrc` from [Song Timer](https://github.com/mhzsajan/songtimer) into a
**lyric-text overlay video** you can drop onto a Videosync2 layer in Ableton
Live, without re-typesetting anything.

Output is **H.264 mp4, 1920x1080 @ 30 fps**: white text on pure black. Set the
layer blend to **Add** or **Screen** in Videosync2 and the black disappears over
your camera feed. Text on black compresses to ~12 KB/s, so a seven-minute song is
about 6 MiB.

**mp4 cannot carry an alpha channel.** That is a format limit, not a missing flag
— h265, VP9 and every other route were tried. "Transparent" here means *blended
away*, which is exactly what the reference video does: it is `yuvj420p` with no
alpha at all. True alpha exists only via `--format mov` (ProRes 4444) at ~3 GB
per song.

By default the audio is muxed in so the file syncs against its own audio. With
`--no-audio` you get a pure text overlay with no audio track at all.

> **Fonts are a separate repo.** This one renders video. Key layouts, the
> 214-font catalogue, and the check for whether a font can write your lyrics all
> live in [`nepali-legacy-fonts`](https://github.com/mhzsajan/nepali-legacy-fonts).
> See [Fonts](#fonts) below and [`docs/FONTS.md`](docs/FONTS.md).

## Requirements

- **Node 16+** (tested on 24.18). `Intl.Segmenter` in `src/letters.js` needs it.
- **Python 3 on `PATH`** — only for `--legacy-font` / `--font-slug`, which
  transcode the lyrics with `scripts/lrc_legacy.py`. It looks for `python`, then
  `py`, then `python3`, and stops with an explanation rather than crashing if
  none work. **A `--font-file` render does not need Python at all.**
- `ffmpeg`/`ffprobe`, `pillow`, `fonttools` are for the verification scripts in
  `scripts/` only — **not** to render. Remotion bundles its own ffmpeg.

## The command

```bash
node render.mjs song.mp3 song.lrc --no-audio --length 409.13 --font-file "C:/fonts/Yantramanav-Black.ttf" --size 128 --mode mix --mix-block 8 --word-anim karaoke --letter-anim pop --letter-var 0.03
```

One line on purpose: these run in PowerShell, where neither `^` nor `\` continues
a line — a multi-line form fails to parse.

**`--length` is required with `--no-audio`.** The composition probes the audio
for its length only when the audio *is* in the composition. A text-only overlay
has nothing to probe, so the length falls back to the last cue — and a `.lrc`
records only when a line **begins**, so that end is a guess. Measured: Kali Kali
is 6:49 of audio, its last lyric ends at 5:47, and the render stopped at 5:49 —
the overlay ended while the song was still playing.

**`--font-file` is the safe default.** It uses the font exactly as it is: no
layout, no transcoding, nothing that can be lost. `--font "Nirmala UI"` is the
zero-install version, and also safe.

## Order of work

```bash
npm install                                  # once

# 1. check the timings — no render, instant
node render.mjs song.mp3 song.lrc --report-only

# 2. fast low-res proof (~1 min) to eyeball the look
node render.mjs song.mp3 song.lrc --font "Nirmala UI" --preview

# 3. the real thing
node render.mjs song.mp3 song.lrc --no-audio --length 409.13 --font-file "C:/fonts/Yantramanav-Black.ttf" --size 128 --mode mix --mix-block 8 --word-anim karaoke --letter-anim pop --letter-var 0.03
```

Output lands in `out/<song name>.mp4` (or `.mov` with `--format mov`).

**`--report-only` without a font flag** if you want to read the lyric text: output
is deliberately ASCII-only (Windows consoles mangle Devanagari), and a legacy
font transcodes to ASCII keys *before* the report prints, so you get `cfxf===`
instead of the words. Cue count and timings are correct either way.

## Then verify it

A render that finishes is not a render that is correct. Everything below exits 0
and prints `OK` when it is wrong:

```bash
# the file: streams, length against the AUDIO, pure black plate
py scripts/check_output.py --no-audio --audio-seconds 409.13 out/"<song>.mp4"

# the timings: did it find the ends file, or is it guessing?
node scripts/check_pairing.mjs
node render.mjs song.mp3 song.remotion_start.lrc --report-only   # -> "ends: N/N timed from ..."

# the font: one still frame, before you commit to a 3-minute render
node render.mjs song.mp3 song.lrc --font-file "C:/fonts/Yantramanav-Black.ttf" --prepare-only
npx remotion still src/index.js LyricOverlay out/check.png --frame=2400 --props=out/props.json
```

`check_output.py` needs `pillow` for the background-purity check — that purity is
what makes the Add/Screen blend key cleanly.

`--prepare-only` prints the exact `still` command, with the frame number from the
middle of the **longest** cue. It used to suggest `--props=out/props.json`
without ever writing that file, so following the hint rendered a still with
default props — wrong size, wrong position, no animation — and it looked
plausible, which defeats the point of a font check.

**The ends file is found by name** beside the `.lrc`, so renaming one side of the
pair is silent: the render falls back to estimating every line end and exits 0.
The cue report says which file it used.

## Workflow

```
song.mp3 + lyrics  ──►  Song Timer  ──►  song.remotion_start.lrc
                                                 + song.remotion_end.lrc
                                                               │
               ┌───────────────────────────────────────────────┼───────────────────────────────┐
               │                                               │                               │
    song_ableset.lrc                              this renderer                      (song.obs.html
               │                                               │                            for OBS)
               ▼                                               ▼
      .als → Ableton + AbleSet                 H.264 mp4, white on black
               (blend Add/Screen)                       ~6 MiB, 30 fps
                                                               │
                                                               ▼
                                                     Videosync2 video layer
```

The `.lrc` is the contract. Timing is authored **once** and consumed twice, so
Ableton and the video can never disagree.

Song Timer names each file for the target it is for, because the AbleSet and
Remotion start files hold the same timestamps and are read by different programs.
The end file is found beside the start file by name — pass either
`.remotion_end.lrc` or `--ends <file>`; the older `<song>.ends.txt` name is still
accepted so older folders keep rendering.

## Options

| Flag | Meaning |
|---|---|
| `--preview` | Quarter size, 15 fps, h264. Fast look check — **not a deliverable**. |
| `--no-audio` | Leave the audio track out: pure text overlay. **Pair it with `--length`**. |
| `--length <s>` | Duration in seconds. **Required with `--no-audio`.** |
| `--out <file>` | Explicit output path. Default `out/<song>.mp4`. |
| `--batch <dir>` | Render every `name.mp3` + `name.lrc` pair in a folder. |
| `--report-only` | Print the cue list and exit. No render at all. |
| `--format <f>` | `mp4` (default, ~6 MiB, black bg) or `mov` (ProRes 4444, real alpha, ~3 GB). |
| `--fps <n>` | Override frame rate. Default 30 (60 with `--format mov`). |
| `--gpu` | Encode with the GPU, in bitrate mode. Faster, larger files. |
| `--prepare-only` | Transcode and register the font, then stop. |

### Font

| Flag | Meaning |
|---|---|
| `--font-file <ttf>` | **Start here.** Any Unicode `.ttf`, used as-is. No layout, no risk. |
| `--font <family>` | A **Unicode** family name. `--font "Nirmala UI"` needs nothing installed. |
| `--font-slug <slug>` | A legacy font **and** its generated layout, from the font repo. |
| `--fonts-repo <dir>` | Where that repo is. Default: a sibling `nepali-legacy-fonts`. |
| `--legacy-font <f>` | A legacy ASCII-mapped font, wired up by hand. Highest risk — see below. |
| `--layout <n>` | Key layout for a legacy font. Default `Preeti`; **wrong for most fonts**. |
| `--layout-file <j>` | The correct generated layout. Use `--font-slug` instead of this. |

### Animation

| Flag | Meaning |
|---|---|
| `--mode <m>` | How a line is **placed**: `center` (default), `roam`, `horizontal`, `vertical`, `mix`. |
| `--mix-block <n>` | Cues per presentation in `mix`. Default 8, minimum 4. |
| `--mix-plan <p>` | Pin presentations by cue range. e.g. `"0-7:h-word,8-15:v-phrase,16+:*"` |
| `--word-anim <m>` | `off` (default), `reveal`, `karaoke`, `pulse`. |
| `--letter-anim <m>` | `off` (default), `fade`, `rise`, `pop`, `wipe`. |
| `--letter-var <n>` | Per-letter size, `0`..`0.03` (default `0`, off). |
| `--size <px>` | Font size. Default `104`. |
| `--size-mode <m>` | Random size per `word` (default), per `phrase`, or `off`. |
| `--size-var <n>` | How far those sizes vary, `0`..`0.45` (default `0.15`). |
| `--color <#hex>` | Text colour. Default `#ffffff`. |
| `--shadow <css>` | Text shadow/halo. Default is a soft dark halo. |
| `--position <pos>` | `top` / `center` / `bottom` (default `center`). |
| `--seed <text>` | Animation seed. Default the `[ti:]` title. |
| `--style <name>` | Pin every line to one animation instead of mixing. |

Animations: `fade`, `rise`, `pop`, `slide-left`, `slide-right`, `typewriter`,
`blur-in`, `zoom-through`.

## Placement: `--mode`

`--mode` is how a line is **placed**. It is independent of `--word-anim` /
`--letter-anim`, which control how a line is **animated** once placed.

| Mode | Look |
|---|---|
| `center` | Lines stack in the middle, the outgoing one drifts up. |
| `roam` | Each line gets its own seeded spot — the reference-video look. |
| `horizontal` | One left-aligned band in the lower third; words arrive left to right. |
| `vertical` | One centred narrow column; lines stack downward. |
| **`mix`** | **All four, planned across the song, word-by-word and phrase-by-phrase.** |

### `mix`: a video that does not look the same all the way through

One mode for the whole video means asking for `horizontal` gives 109 cues of
horizontal — legible, and completely monotonous. `mix` plans a **presentation**
per block instead. A presentation is two independent choices:

| | `word` (karaoke, one word at a time) | `phrase` (whole line at once) |
|---|---|---|
| **`horizontal`** | `h-word` | `h-phrase` |
| **`vertical`** | `v-word` | `v-phrase` |
| **`center`** | `c-word` | `c-phrase` |
| **`roam`** | `r-word` | `r-phrase` |

`--word-anim` and `--letter-anim` apply to the **word** blocks. A `phrase`
presentation deliberately ignores them: "the whole line arrives at once" is the
point of the phrase unit, and popping letters one at a time would be the word
unit wearing a different hat.

The render log prints the whole plan, because a mixed video cannot be debugged
from the picture — *"it looked wrong at 2:40"* points at nothing:

```
mix plan (109 cues, 8 presentations):
  cues 1-8  h-phrase
  cues 9-16 v-phrase
  cues 17-24 r-word
  ...
```

**`--mix-block N` is cues per presentation** (default 8, minimum 4). This is not
a style knob. At Allare's median 1.4s per cue, one presentation per cue is not
variety, it is a flicker the eye never resolves.

**The order is a shuffled deck, not a random pick.** All eight presentations are
dealt one per block, in an order where no two neighbours share a placement —
including across the seam where one cycle of eight ends and the next begins. So
all eight appear within the first eight blocks *by construction*, and the same
seed always deals the same deck. A strided walk was tried first and abandoned: it
silently dropped `r-word` and `c-word` from the entire 109-cue video.

At a block boundary each line is drawn in its own presentation, so the change is
a cross-fade between two layouts rather than the text teleporting.

### `horizontal` with word-by-word animation

`roam` fights a karaoke sweep. In roam each line lands somewhere new, so the
audience re-finds the text on every line, and a word-by-word highlight chases a
target that keeps jumping. Pinned to one band, the same animation reads as a
single continuous left-to-right progression.

Band geometry: left edge `11vw`, width `64vw`, top `56%` (`--position` moves it:
`top` 24%, `center` 56%, `bottom` 70%). The band sits in the **lower** half on
purpose — it is lyrics over a camera feed, so the text has to clear a performer's
head and shoulders.

### Long lines auto-fit, from a measurement

A wrapped block grows downward from a fixed top, so a long cue would otherwise run
off the bottom. Allare's longest cue is 50 characters; at 128px in a 64vw band it
wraps to two or three lines, and the last is clipped off screen — with no error.

The renderer must decide the size *before* it renders, so width is predicted from
per-font coefficients rather than measured live. Those coefficients are **fitted
from real measurements**:

```bash
node scripts/calibrate_width.mjs --font "<Family>" --font-file <ttf> --audio song.mp3 --lrc song.lrc --force
```

which renders sample lines in the same browser that will render the video,
measures the ink they leave, and solves for the width of a consonant, a matra and
a space. Three cheaper estimates were tried first and all three were wrong in
ways that looked right:

| Estimate | Nirmala UI | What went wrong |
|---|---|---|
| `0.55em` per code point | — | A Preeti-era face is ~0.48em, so every legacy line was predicted to wrap when it does not, and got shrunk ~28% for nothing. |
| mean of the font's `hmtx` advances | 0.7153em | Counts a pre-base matra as full width. Shaping reorders `ि` into space its consonant already owns, so the real cost is ~0.33em. This predicted **three** lines for a line the browser draws on **one**. |
| mean over consonants only | 0.7480em | Still averages narrow spaces in with wide consonants. |

The current model measures the real Allare line to **0.6%** and its whole line set
to **2.0%** by leave-one-out, with the browser agreeing about whether every line
wraps. Yantramanav Black: **0.9%**, same 0 wrap disagreements. On Allare,
`हो.. खोला वारि म कहिले` used to be shrunk from 128px to 96px to fit a wrap that
never happened; it now draws at 128px and wraps where the browser wraps.

**Each font has its own entry**, keyed by family *and* by whether a song's own
lines were used, so a fit on Allare is not silently reused elsewhere. Calibrate
after changing the font, the classifier, or the band widths, and check the render
log names the table it used — a face whose numbers are identical to another
face's was measured on the wrong font, and that happened here: Yantramanav came
out bit-identical to Nirmala UI, to four decimals.

Short lines are predicted badly — `सधैँ..` is 62% out, because a short line
carries a full side bearing on each side while a long one amortises it. It does
not matter: a short line never wraps, so the fit returns the full size whatever
the model says. `node scripts/check_width_model.mjs` asserts the classifier, the
cached coefficients and the consumer still agree.

## Two things worth knowing

**The animation is seeded, not random.** Each line's style comes from
`(seed, cueIndex)`, so re-rendering the same song produces a byte-identical
result. That matters live: you render once, and the video must keep matching your
show file. Change the look by changing `--seed`, not by re-rendering.

**Word timings are derived, never stored.** `--word-anim karaoke` divides each
cue's span among its words in proportion to character count at render time. The
`.lrc` is untouched, so the file AbleSet and Ableton read stays exactly as Song
Timer wrote it.

**Per-letter animation, but a very small per-letter size.** `--letter-anim pop`
adds a second layer inside each word. Letters split on **grapheme clusters**
(`Intl.Segmenter`), not characters, so `क्ष` stays one glyph and the pre-base
matra in `नि` stays attached to the left of its consonant.

`--letter-var` is capped at **0.03** and that cap is measured, not stylistic.
Devanagari's headline bar (shirorekha) runs continuously across a word, so two
letters at different sizes snap it in half. At 0.08 the bar visibly breaks into
segments; at 0.12 the word looks damaged. Animation is safe at any strength — a
letter can appear without changing size — which is why the two are separate flags.

**Always preview first.** The one ProRes render measured end to end — Allare,
417 s at 1080p60 — came out at **3.2 GB** and took minutes to encode, roughly
8 MB per second of video. `--preview` renders the same timing in seconds.

## Fonts

Three paths, in risk order. Pick the first that gives you the look you want.

| | flag | risk |
|---|---|---|
| **1** | `--font-file <ttf>` | **None.** No layout, no transcoding, no way to lose a character. |
| **2** | `--font-slug <slug>` | Real but bounded: the layout comes from the font repo *with* the `.ttf`, so it cannot silently fall back to the wrong map. |
| **3** | `--legacy-font <ttf>` | **Highest.** A missing `--layout-file` falls back to Preeti and renders wrong letters with no error. |

```bash
# 2 - legacy font, layout resolved for you
node render.mjs song.mp3 song.lrc --no-audio --length 417.10 --size 128 --mode mix --mix-block 8 --font-slug ams-manthan

# check the song first; exits 1 if the font cannot write it
py C:/Users/Admin/tools/nepali-legacy-fonts/scripts/check_song.py --font ams-manthan song.lrc
```

**"Custom font" does not mean "legacy font."** The font repo has 214 fonts, of
which **58 are Unicode** — and many of those are display faces: Yantramanav Black,
Halant, Khand, Teko, Modak, Sahitya, Mukta, Baloo 2, Palanquin Dark, Biryani,
Rozha One, Gajraj One, Asar. The "alive" look comes from the *typeface*, not the
*encoding*, and a Unicode face gives you the look with none of the risk.

`scripts/contact_sheet.mjs` renders candidates side by side so the choice is made
on the type itself rather than on a table of names:

```bash
node scripts/contact_sheet.mjs --audio song.mp3 --lrc song.lrc --size 64
# -> out/contact-sheet.png
```

Each row is a real render through `--font-file` at the real size, with the song's
longest line — **no** word or letter animation and a tight shadow, because a
comparison has to isolate the one variable it is comparing. The first attempt
rendered them with the full presentation and every row came out a featureless
white blob: the shirorekha bars merged through a 60px glow.

The family name is read **out of the font file**, not taken from `--font`, because
the two disagree more often than not and a name that does not resolve does not
error — the CSS falls through, the browser draws the system font, and the render
looks exactly as though the flag was ignored. Real disagreements in this project's
own fonts: `Yantramanav` in the file vs `Yantra Manav` in a README, `Halant` vs
`Halant New`.

### Why a legacy font is not just "a different look"

A layout that **verifies** is a statement about the font, not about the song. The
font repo reports AMS Manthan as *proven* — every key reaches a real glyph — and
it still cannot write Allare:

```
15 of 35 lines (43%) contain a character with no key
U+094D virama       x14     U+0901 candrabindu  x13
16 distinct words affected

!! not round-trip exact: 'फर्केर' -> 'fker'
```

`फर्केर` becomes **`फरकर`** on screen — a different word. The reason is worth being
precise about, because it looks like a missing diacritic and is not: the virama
is the instruction that *fuses* a conjunct, so dropping it splits one character
into two letters. The candrabindu is the gentler failure — `सँगै` → `संगै` changes
the spelling, usually not the word.

**All 79 layouts fail this song**, because aNepali publishes neither character as
a key, so no generated layout can contain them. No different legacy font helps.

The render exits 0, the file is the right length, the plate is pure black, and
`check_output.py` passes every check — because every check looks at the container,
the timing, or the pixels *behind* the text, and none of them look at the text.

So run `check_song.py` before choosing a legacy font for a song. Full write-up:
[SONG-CHECK.md](https://github.com/mhzsajan/nepali-legacy-fonts/blob/main/docs/SONG-CHECK.md).

A legacy font also needs a different width model — it is handed ASCII key
sequences, so every character classifies as `space` and the per-class model
collapses. It gets one measured number instead (`per code point`); see
`widthEm()` in `src/width-model.mjs`.

Defaults to `"Noto Sans Devanagari", "Nirmala UI"` so Devanagari renders correctly
on Windows. Override with `--font` or a `LYRIC_FONT` env var.

## The target look

`ritu-whisper.mp4` is the file this pipeline aims at — a Remotion render whose
format our mp4 output already reproduces to within ~1% (same codec, pixel format,
resolution, frame rate, no audio, ~12 KB/s, pure black background). What it still
does that we do not: head and tail title cards, wrapping long cues onto two
lines, and a white halo on every line.

All measurements are in [`docs/REFERENCE.md`](docs/REFERENCE.md). Re-run them, or
A/B a new render against the reference:

```bash
python scripts/reference_survey.py <video>                # one file
python scripts/reference_survey.py <reference> <ours>     # A/B + suggested --size
```

## Compositing notes

- The frame is **1920x1080 @ 30 fps** for mp4, **@ 60 fps** for `--format mov`.
  If your Videosync2 project differs, change `WIDTH`/`HEIGHT` in `src/Root.jsx`
  **and** re-render — a frame-rate mismatch makes the text drift against the
  camera. **30 fps is the default on purpose**; it matches the Videosync2 source.
- Drop the `.mp4` on a video layer **above** the camera layer and set the blend
  to **Add** or **Screen** — black becomes transparent, no keying required. A
  ProRes 4444 `.mov` from `--format mov` carries real alpha if your host reads it,
  at ~3 GB.
- Text is pure `#ffffff` on pure `#000000` for the same reason. `--shadow` adds a
  soft dark halo so white text still reads over a bright feed.

## Documentation

| | |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Orientation for agents, plus ~25 gotchas that cost real time. **Read before changing anything.** |
| [`docs/FONTS.md`](docs/FONTS.md) | Fonts, at render time only. |
| [`docs/PLAYBOOK.md`](docs/PLAYBOOK.md) | The full production procedure. |
| [`docs/REFERENCE.md`](docs/REFERENCE.md) | Measurements of the target look. |
| [`nepali-legacy-fonts`](https://github.com/mhzsajan/nepali-legacy-fonts) | Fonts, layouts, and whether a font can write your lyrics. |
