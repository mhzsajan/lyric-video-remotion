# The reference look — `ritu-whisper.mp4`

`ritu-whisper.mp4` is the file the user picked as **the** target look. This is
what was measured off it, what our renderer already matches, and what it still
does that we do not.

Everything here was measured with ffprobe/ffmpeg, not judged by eye. Re-run the
measurements any time with:

```bash
python scripts/reference_survey.py <video>          # any file, one pass
python scripts/reference_survey.py <a> <b>          # A/B, prints a diff
```

Numbers below were taken 2026-09-29 against Remotion 4.0.529 outputs.

---

## 1. Provenance

| | |
|---|---|
| File | `ritu-whisper.mp4` — 3,414,640 B (3.3 MiB) |
| Song | Ritu — Deepak Bajracharya & The Rhythm Band |
| Duration | 273.37 s, 8201 frames |
| Built with | `comment: Made with Remotion 4.0.526`, `encoder: Lavf61.7.100` |

It is a Remotion render, same tool as this repo (we run 4.0.529), so it is a
like-for-like target rather than an unrelated piece of stock footage.

## 2. The encode recipe — this is the "perfect file size"

| Property | Reference | Our `out/Ritu.mp4` |
|---|---|---|
| Container | mp4 (`isom`/`avc1`) | mp4 |
| Video codec | h264, **High** profile | h264 |
| Pixel format | `yuvj420p` (full-range 4:2:0, 8-bit) | `yuvj420p` |
| Resolution | 1920x1080 | 1920x1080 |
| Frame rate | 30/1 | 30/1 |
| Audio stream | **none** | **none** (`--no-audio`) |
| Background | pure black, measured `sum(RGB)=0` | pure black, `sum=0` |
| Throughput | **12.2 KB/s** (99.9 kbps) | **12.1 KB/s** |
| Total | 3.3 MiB / 273 s | 3.0 MiB / 253 s |

**We already reproduce this to within 1%.** The recipe is

```bash
node render.mjs <audio> <lrc> --no-audio --legacy-font Abhinav.TTF --mode roam
```

which defaults to mp4 / h264 crf 17 / 30 fps / black background.

Two facts worth never re-deriving:

- **The reference has no alpha channel.** `yuvj420p` cannot carry one. Its
  "transparent background" is black + **Add** or **Screen** blend in Videosync2
  — exactly what our mp4 assumes. Alpha is only worth paying for with
  `--format mov`.
- **Nothing about the file size is mysterious.** Text on black compresses to
  roughly 12 KB/s at crf 17 regardless of song length, so a 7-minute song is
  ~5 MiB. The multi-gigabyte files in this project came from choosing ProRes,
  not from any property of the content (see §6).

## 3. What the reference does that we do not

### 3.1 Head card and tail card

| | Reference |
|---|---|
| Head, ~0–40 s | `रीतु` in large legacy Devanagari **plus** `DEEPAK BAJRACHARYA & THE RHYTHM BAND` in letter-spaced Latin caps, centred at (958, 548), block 676x308, heavy glow |
| Tail, ~265–273.5 s | `रीतु` alone, smaller, centred at (960, 536), block 196x168 |

Our render starts black and begins at the first `.lrc` cue. Both cards are
missing features, and the tail card is why the reference runs 20 s longer than
ours. **Not implemented.**

### 3.2 Line height, and wrapping

| | Reference | Ours |
|---|---|---|
| Line height (core ≥200) | median **104 px** (75–146, n=9) | median **87 px** (83–104, n=5) |
| Long cues | 2–3 stacked lines | wraps to 2 lines via `maxWidth: 60vw` |

**Correction:** an earlier version of this doc claimed we "always" render one
line. That was measured on Ritu, whose cues happen to be short. Allare's longest
cue measures 2 lit bands at t=407 s, so wrapping already happens. The real
difference is *when* it wraps — the reference breaks earlier and more often,
which composes the frame instead of running a near-full-width line, because its
text block is narrower than our 60vw.

The reference's glyphs are taller than ours: **1.20x** on the survey's default
sample, **1.29x** when sampling lyric frames only. At our default `--size 104`
that puts the matching size around **`--size` 125–134**.

Do not treat that as a measured optimum. The sample is under ten lines, and
Devanagari line height moves with matras and stacked consonants, so the ratio
drifts with whichever cues happen to be on screen — hence the two figures above.
Take it as a starting point for an eyeball check at 1080p, and recompute with:

```bash
python scripts/reference_survey.py <reference> <our-render>
```

### 3.3 Uniform word size

The reference sets **every word to the same size**. Our default is
`--size-mode word` (randomised). So reproducing the reference exactly requires
`--size-mode off`. Randomisation is a deliberate addition for live mixing, not
a defect — but it is a *difference*, and if a render is meant to match the
reference shot for shot, turn it off.

### 3.4 A soft white halo

Measured on the densest scanline of a full-opacity reference line (t=185 s),
walking outward from the glyph edge over 70 px:

```
... 0 0 0 0 0 0 0 0 1 1 2 2 2 2 3 5 6 7 8 10 11 18 15 22 34 44 | 201 230 230 229
                                                        glow ~18-20 px      ^ glyph
```

So: a white bloom about **18–20 px** wide, peaking near **44/255 (17 %)**
immediately outside the glyph, then a hard jump to the 201–233 glyph core.

This repo already carries a `glow` animation style —

```js
`0 0 ${18 + j * 14}px rgba(255,255,255,0.95), 0 0 ${60 + j * 40}px rgba(255,255,255,0.55)`
```

— which is in the right family, but it is **one style in the animation pool**,
not a global effect, so most lines render with the default *dark* shadow
(`0 3px 18px rgba(0,0,0,0.55), 0 0 60px rgba(0,0,0,0.35)`) and come out with a
hard edge like our measured t=95 frame. If the reference's consistent soft look
is wanted, the glow has to be applied to every line rather than picked per cue.

## 4. What the reference does that we already do

**Roaming positions.** Neither file pins text to the centre. Total content
extent across every frame (a cumulative union of the crop bounding boxes):

| | x extent | y extent | min margin L/R/T/B |
|---|---|---|---|
| Reference | 314 – 1512 | 176 – 826 | 314 / 408 / 176 / 254 |
| Ours, before `633b82b` | 0 – 1364 | 76 – 718 | 0 / 556 / 76 / 362 |

The reference never comes within 314 px of the left edge and never into the
bottom third. Our older renders *did* touch x=0 — long chorus lines clipped
over 100 px off the left at an x=20 % anchor. That is fixed in `633b82b`,
which constrains roam anchors to **x 32–68 %, y 24–66 %**; re-render before
assuming the old extents still hold.

> Measurement note: these extents come from `cropdetect` with `reset=0`, which
> accumulates rather than reporting per frame. They are the **union** of every
> position used, i.e. the total area roamed over — not per-frame margins.

## 5. Do not use it as a timing reference

The reference's cue times do **not** match `Ritu.lrc` (the filename says
*whisper*, i.e. ASR-derived timings):

| | |
|---|---|
| Reference at t=145 s | `मेरो आशा नगर,` — our `.lrc` puts `मेरो आश नगर,` at **71.07 s** |
| Ours at t=145 s | `सजिलै माया पाउन,` — our `.lrc` cue at **144.17 s** ✓ |
| Durations | reference 273.37 s, ours 253.00 s, `Ritu.mp3` 293.39 s |

Our render is the one that agrees with the `.lrc`. Use the reference for
**style only**; timing comes from Song Timer and nowhere else.

Our 253 s is last cue (242.42 s) + ~10.6 s of tail, not the 293 s audio length
— deliberate, since after the final line there is nothing to show.

## 6. Files currently in the song folders

As of this writing, and **their fonts are wrong — all three need re-rendering:**

| File | Size | Note |
|---|---|---|
| `Final\Allare\Allare - Text Only.mov` | **3,200,797,033 B (3.2 GB)** | ProRes 4444, 417 s. This is the file that motivated the mp4 default. |
| `Final\Ritu\Ritu - Text Only.mp4` | 5,568,315 B (176 kbps) | Text does not match `Ritu.lrc` at any cue checked. |
| `Final\Kali Kali\Kali Kali - Text Only.mp4` | 7,817,225 B | Wrong fonts. |

Neither `Kali Kali` nor `Ritu` has been validated through `--legacy-font`
before; **Allare is the only proven song** (35/35 lines round-tripped).

## 7. Open work

- [ ] Head/tail title cards (§3.1).
- [ ] Two-line wrapping for long cues (§3.2).
- [ ] Decide the target size: current `--size 104` vs reference-derived `~134`.
- [ ] Decide whether the white halo should be global instead of one style in
      the pool (§3.4).
- [ ] Re-render **Kali Kali** and **Ritu** with the proven command (§6).
- [ ] Confirm 1920x1080@30 against the Videosync2 project (read it off an
      `.als` if the project file is reachable).
- **Next after that:** word-by-word animation and musical beat sync.
