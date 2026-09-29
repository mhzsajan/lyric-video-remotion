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
```
node render.mjs song.mp3 song.lrc --no-audio --length 409.13 --font "Nirmala UI" --size 128 --mode roam --word-anim karaoke --letter-anim pop --letter-var 0.03
```

(Written on one line on purpose: these run in PowerShell, where neither `^` nor
`\` continues a line — a multi-line form fails to parse.)

**Start with a Unicode font.** `--font "Nirmala UI"` ships with Windows 11, so
it needs no install, no transcoding and no layout file, and it cannot render a
character in the wrong typeface. 58 of the fonts in
[nepali-legacy-fonts](https://github.com/mhzsajan/nepali-legacy-fonts) are
Unicode.

**`--length` is required with `--no-audio`.** The composition probes the audio
for its length only when the audio *is* in the composition. A text-only overlay
has nothing to probe, so the length falls back to the last cue — and a `.lrc`
records only when a line **begins**, so that end is a guess. Measured: Kali Kali
is 6:49 of audio, its last lyric ends at 5:47, and the render stopped at 5:49 —
the overlay ended while the song was still playing.

## The legacy-font path is the exception

`--legacy-font` is for a *specific* classic typeface that no Unicode font
provides. It works, and it has real costs — measured on two songs, 110 distinct
lyric words:

| Character | Words | Consequence |
|---|---:|---|
| `्` virama | 21 | conjuncts unrenderable |
| `ँ` candrabindu | 12 | आँ, सँ, कहिँ broken |
| `ञ` | 1 | चञ्चल broken |

**34 words** need a character the layout cannot encode. Those characters reach
the font unmapped, so Chromium substitutes a *different* font for them alone —
the word comes out in two typefaces, and the stray mark reads as a `0` or an
`O` inside an otherwise correct word.

Check before rendering anything:

```bash
py scripts/passthrough.py layouts/ams-manthan.json "song.lrc"
py scripts/diag_encode.py layouts/ams-manthan.json --lrc "song.lrc"
```

And read the render log: `!! not round-trip exact: 'x' -> 'keys'` means that
word is wrong. A clean run prints only `OK ... lines encoded`.

**Do not assume one custom font's layout works for another.** Abhinav renders
correctly because `npttf2utf` supplies the virama — a property of the *Preeti
layout*, not of this renderer. Feeding Preeti keys to `ams.manthan.ttf` gives
collapsed glyphs and a literal `==` where the danda should be. Full write-up:
[LEGACY-PITFALLS.md](https://github.com/mhzsajan/nepali-legacy-fonts/blob/main/docs/LEGACY-PITFALLS.md).

Order of work:

```bash
npm install                                  # once

# 1. check the timings — no render, instant
node render.mjs song.mp3 song.lrc --report-only

# 2. fast low-res proof (~1 min) to eyeball the look
node render.mjs song.mp3 song.lrc --font "Nirmala UI" --preview

# 3. the real thing. --length matters: without it a --no-audio render ends
#    where the last lyric ends, which can be a minute before the song does.
node render.mjs song.mp3 song.lrc --no-audio --length 409.13 --font "Nirmala UI" --size 128 --mode roam --word-anim karaoke --letter-anim pop --letter-var 0.03
```

Output lands in `out/<song name>.mp4` (or `.mov` with `--format mov`).

**Then verify it.** A render that finishes is not a render that is correct —
every failure below exits 0 and prints `OK`:

```bash
py scripts/check_output.py out/"<song>.mp4"          # audio + length + black plate
py scripts/check_output.py --no-audio --audio-seconds 409.13 out/"<song>.mp4"
```

It checks the stream list, that the file is as long as the audio rather than
as long as the lyrics, and that the background is pure `#000000` — which is
what makes the Add/Screen blend key cleanly. It needs `pillow` for the last
one.

**Check a font before trusting it.** `--prepare-only` then one `still` frame
costs seconds and is the only step that catches a wrong font — a bad layout
does not error, it renders the wrong letters.

```bash
node render.mjs song.mp3 song.lrc --legacy-font ams.manthan.ttf --layout-file layouts/ams-manthan.json --prepare-only
npx remotion still src/index.js LyricOverlay out/check.png --frame=2400 --props=out/props.json
```

`--prepare-only` now writes `out/props.json` and prints the exact `still`
command, with the frame number taken from the middle of the **longest** cue. It
used to suggest `--props=out/props.json` without ever writing that file, so
following the hint rendered a still with default props — wrong size, wrong
position, no word animation — and it looked plausible, which is the whole
problem with a font check.

**Check that the timings file was found.** The ends file is looked up by name
beside the `.lrc`, so a rename on one side of the pair is silent: the render
falls back to estimating every line end and exits 0. The cue report says which
file it used, and `--report-only` costs nothing.

```bash
node scripts/check_pairing.mjs    # the .lrc <-> ends file naming contract
```

**Check the width model** if you changed a font, the classifier, or the band
widths — a wrong coefficient makes the text quietly too small, which is
invisible in a still of a short line:

```bash
node scripts/check_width_model.mjs
node scripts/calibrate_width.mjs --font "Nirmala UI" --lrc song.lrc --force
```

```bash
node scripts/check_pairing.mjs                             # the naming contract
node render.mjs song.mp3 song.remotion_start.lrc --report-only   # -> "ends: N/N timed from ..."
```

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
Remotion start files hold the same timestamps and are read by different
programs. The end file is found beside the start file by name — pass either
`.remotion_end.lrc` (current) or `--ends <file>`; the older `<song>.ends.txt`
name is still accepted so folders exported before the rename keep rendering.

## Options

| Flag | Meaning |
|---|---|
| `--preview` | Quarter size, 15 fps, h264. Fast look check — **not a deliverable**. |
| `--no-audio` | Leave the audio track out: pure text overlay for layering. **Pair it with `--length`** — see below. |
| `--length <s>` | Duration in seconds. **Required with `--no-audio`**, or the video ends where the last *lyric* ends rather than where the song does. |
| `--font <family>` | A **Unicode** Devanagari font. **Try this first** — `--font "Nirmala UI"` needs nothing installed. |
| `--legacy-font <f>` | A legacy ASCII-mapped font. Only for a specific classic look; see the warning below. |
| `--layout <n>` | Key layout for `--legacy-font`. Default `Preeti`; wrong for most fonts. |
| `--layout-file <j>` | Generated layout for a font outside npttf2utf's five. See [nepali-legacy-fonts](https://github.com/mhzsajan/nepali-legacy-fonts). |
| `--prepare-only` | Transcode and register the font, then stop. Pair with `remotion still` to check a font in seconds. |
| `--gpu` | Encode with the GPU (NVENC, or whatever the machine has). Faster but larger files — it cannot use `--crf`. |
| `--report-only` | Print the cue list and exit. No render at all. |
| `--style <name>` | Pin every line to one animation instead of mixing. |
| `--position <pos>` | `top` / `center` / `bottom` (default `center`). |
| `--mode <m>` | How a line is **placed**: `center` (default), `roam` (own spot per line), `horizontal` (one left-aligned band). See below. |
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

## Placement: `--mode`

`--mode` is how a line is **placed** on the frame. It is independent of
`--word-anim` / `--letter-anim`, which control how a line is **animated** once
placed.

| Mode | Look |
|---|---|
| `center` | Lines stack in the middle, the outgoing one drifts up. |
| `roam` | Each line gets its own seeded spot — the reference-video look. |
| `horizontal` | One left-aligned band in the lower third; lines stack downward, words arrive left to right. |
| `vertical` | One centred narrow column; lines stack downward. |
| **`mix`** | **All four, planned across the song, word-by-word and phrase-by-phrase.** |

### `mix`: a video that does not look the same all the way through

`--mode` used to be one value for the whole video, which means asking for
`horizontal` gives 109 cues of horizontal — legible, and completely monotonous.
`mix` plans a **presentation** for every block of the song instead. A
presentation is two independent choices:

| | `word` (karaoke, one word at a time) | `phrase` (the whole line at once) |
|---|---|---|
| **`horizontal`** | `h-word` | `h-phrase` |
| **`vertical`** | `v-word` | `v-phrase` |
| **`center`** | `c-word` | `c-phrase` |
| **`roam`** | `r-word` | `r-phrase` |

```bash
node render.mjs song.mp3 song.lrc --no-audio --length 417.10 \
    --size 128 --mode mix --mix-block 8 \
    --word-anim karaoke --letter-anim pop --letter-var 0.03
```

`--word-anim` and `--letter-anim` apply to the **word** blocks. A `phrase`
presentation deliberately does not use them: "the whole line arrives at once" is
the point of the phrase unit, and popping the letters one at a time would be the
word unit wearing a different hat.

The render log prints the whole plan, because a mixed video cannot be debugged
from the picture — *"it looked wrong at 2:40"* points at nothing:

```
mix plan (109 cues, 8 presentations):
  cues 1-8  h-phrase
  cues 9-16  v-phrase
  cues 17-24  r-word
  ...
```

**`--mix-block N` is cues per presentation** (default 8, minimum 4). This is not
a style knob. At Allare's median 1.4s a cue, one presentation per cue is not
variety, it is a flicker the eye never resolves.

**The order is a shuffled deck, not a random pick.** All eight presentations are
dealt out one per block, in an order where no two neighbours share a placement —
including across the seam where one cycle of eight ends and the next begins. So
all eight appear within the first eight blocks *by construction*, and the same
seed always deals the same deck, because the file is rendered once and then used
live.

Pin a specific verse with `--mix-plan`:

```bash
--mix-plan "0-7:h-word,8-15:v-phrase,16+:*"
```

Ranges are 0-based cue indices; `16+` runs to the end and `*` hands back to the
automatic walk, so a three-line override is a valid thing to write.

At a block boundary **each line is drawn in its own presentation**, so the change
is a cross-fade between two layouts rather than the text teleporting.

### Use `horizontal` with word-by-word animation

`roam` fights a karaoke sweep. In roam each line lands somewhere new, so the
audience re-finds the text on every line, and a word-by-word highlight has to
chase a target that keeps jumping. Pinned to one band, the same animation
reads as a single continuous left-to-right progression — which is the whole
point of it.

```bash
node render.mjs song.mp3 song.lrc --no-audio --length 409.13 \
    --font "Nirmala UI" --size 128 \
    --mode horizontal --word-anim karaoke
```

Band geometry: left edge `11vw`, width `64vw`, top `56%` (`--position` moves
it: `top` 24%, `center` 56%, `bottom` 70%). The band sits in the **lower**
half on purpose — it is lyrics over a camera feed, so the text has to clear a
performer's head and shoulders.

### Long lines auto-fit, from a measurement

A wrapped block grows downward from a fixed top, so a long cue would otherwise
run off the bottom of the frame. Allare's longest cue is 50 characters; at 128px
in a 64vw band it wraps to two or three lines, and the last one is clipped off
the screen — with no error anywhere.

The renderer has to decide the size **before** it renders, so the width is
predicted from per-font coefficients rather than measured live. Those
coefficients are **fitted from real measurements**:

```bash
node scripts/calibrate_width.mjs --font "Nirmala UI" --lrc song.lrc
```

which renders sample lines in the same browser that will render the video,
measures the ink they leave, and solves for the width of a consonant, a matra
and a space. Three cheaper estimates were tried first and all three were wrong
in ways that looked right:

| Estimate | Nirmala UI | What went wrong |
|---|---|---|
| `0.55em` per code point | — | A Preeti-era face is ~0.48em, so every legacy line was predicted to wrap when it does not, and got shrunk ~28% for nothing. |
| mean of the font's `hmtx` advances | 0.7153em | Counts a pre-base matra as full width. Shaping reorders `ि` into space its consonant already owns, so the real cost is ~0.33em per code point. This predicted **three** lines for a line the browser draws on **one**. |
| mean over consonants only | 0.7480em | Still averages narrow spaces in with wide consonants. |

The current model measures the real Allare line to **0.6%** and the whole set of
its lines to **2.0%** by leave-one-out, with the browser agreeing about whether
every line wraps. Yantramanav Black, measured the same way, is **0.9%** with the
same 0 wrap disagreements. On Allare, `हो.. खोला वारि म कहिले` used to be shrunk
from 128px to 96px to fit a wrap that never happened; it now draws at 128px and
wraps where the browser wraps.

**Each font has its own entry**, because the coefficients are the font's. The
calibration is keyed by family *and* by whether a song's own lines were used, so
a fit on Allare is not silently reused for another song. **Calibrate after
changing the font, the classifier, or the band widths**, and check that the
render log names the table it used — a face whose numbers are identical to
another face's was measured on the wrong font, and that happened here.

Short lines are predicted badly — `सधैँ..` is 62% out, because a short line
carries a full side bearing on each side while a long one amortises it. It does
not matter: a short line never wraps, so the fit returns the full size for it
whatever the model says. The calibrator reports that split on purpose, because
one overall figure would say "52% error" and imply the model is unusable when
every line it is actually consulted for is within 2%.

`node scripts/check_width_model.mjs` asserts the classifier, the cached
coefficients and the consumer still agree.

There is **one** return path through `LyricOverlay` now. It used to be three,
and a fourth and fifth were about to be added — at which point every future
placement would have been a chance to leave something out of one of them. That
already happened once: `<Audio>` was only in the centre path, so every
`--mode roam` render came out silent while still exiting 0. Placement is a
per-cue property and there is nowhere else it can go wrong.

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

**`--font-file <ttf>` uses a font as-is. `--legacy-font` transcodes. They are
opposite things and cannot be combined.**

| | `--font-file` | `--legacy-font` |
|---|---|---|
| Lyrics are | Devanagari, **unchanged** | converted to Preeti keys |
| Needs a layout file | no | **yes** |
| Can render wrong letters | **no** | yes — see below |
| Use it for | any distinctive Devanagari face | a specific legacy typeface |

```bash
node render.mjs song.mp3 song.lrc --no-audio --length 417.10 --size 128 \
    --mode mix --mix-block 8 \
    --font-file "C:/Users/Admin/tools/nepali-legacy-fonts/fonts/yantramanav/YantraManav-Black.ttf" \
    --shadow "0 3px 14px rgba(0,0,0,0.8)"
```

The family name is read **out of the font file**, not taken from `--font`,
because the two disagree more often than not and a name that does not resolve
does not error — the CSS falls through to the next entry, the browser draws the
system font, and the render looks exactly as though the flag was ignored.

### "Custom font" does not mean "legacy font"

`nepali-legacy-fonts` has 214 fonts, of which **58 are Unicode** — and many of
those are display faces: Yantramanav Black, Halant, Khand, Teko, Modak, Sahitya,
Mukta, Baloo 2, Palanquin Dark, Biryani, Rozha One, Ek Mukta, Gajraj One, Asar.
The "alive" look comes from the *typeface*, not from the *encoding*, and a
Unicode face gives you the look with none of the risk.

`scripts/contact_sheet.mjs` renders the candidates side by side so the choice is
made on the type itself rather than on a table of names:

```bash
node scripts/contact_sheet.mjs --audio song.mp3 --lrc song.lrc --size 64
# -> out/contact-sheet.png
```

Each row is a real render through `--font-file`, at the real size, with the
song's longest line — **no** word animation, **no** per-letter animation and a
tight shadow, because a comparison has to isolate the one variable it is
comparing. The first attempt did render them with the full presentation and
every row came out as a featureless white blob: the shirorekha bars of adjacent
glyphs merged through a 60px glow.

### Why a legacy font is not just "a different look"

A layout that **verifies** is a statement about the font, not about the song.
`nepali-legacy-fonts` reports AMS Manthan as *proven* — every key reaches a real
glyph — and it still cannot write Allare:

```
12 of 35 lines (34%) contain a character with no key
U+0901 candrabindu  x13      U+094D virama  x11
15 distinct words affected

!! not round-trip exact: 'फर्केर' -> 'fker'
```

`फर्केर` becomes **`फरकर`** on screen — a different word — because the े matra
and the `र्` half-form are not in the layout. The render exits 0, the file is the
right length, the plate is pure black, and `check_output.py` passes every check,
because none of those can see a wrong letter.

**So: before choosing a legacy font for a song, convert the song and count what
does not survive.** `scripts/lrc_legacy.py` prints the round-trip failures, and
every line it complains about is a line that will be wrong on screen. A Unicode
font has no equivalent failure, because nothing is transcoded and there is no
layout that can be wrong.

A legacy font also needs a different width model — it is handed ASCII key
sequences, so every character classifies as `space` and the per-class model
collapses. It gets one measured number instead (`per code point`); see
`widthEm()` in `src/width-model.mjs`.

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
