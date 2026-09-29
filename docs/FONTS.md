# Fonts — what actually works here

Two completely separate ways to get Devanagari onto the screen. Pick one;
mixing them up is the failure that cost the most time.

| Track | Input text | Renderer sees | Command |
|---|---|---|---|
| **A — Unicode** | real Devanagari (`फर्केर`) | U+0900 block | `--font "Mukta"` |
| **B — Legacy** | Preeti ASCII keys (`kms]{/`) | U+0020 block | `--legacy-font Abhinav.TTF` |

A font belongs to one track. Ask it three questions.

## Why these fonts are like this (the history)

They were built for **legacy Encoded-Nepali** workflows — Preeti and friends.
You were never meant to type Devanagari: you typed ASCII, and the font's ASCII
glyphs *were drawn as* Devanagari, laid out in byte order. The font and the
encoding were a matched pair.

Legacy Windows text stacks (GDI, font-linking, ANSI codepage tricks) render
them happily. The modern web stack refuses by design: HarfBuzz shaping plus
strict Unicode cmaps. That is the whole reason they "look fine in the old
editor but do nothing in the browser" — and why the fix was to convert the
**text** into the font's native encoding, not to convert the font.

## The three checks

A font renders Devanagari in Chromium only if **all three** hold:

1. **cmap covers U+0900–U+097F.** Otherwise Chromium has no glyph to pick and
   silently substitutes a *different font, character by character*. No error,
   no warning — you just get the wrong typeface mid-word. This is why
   `--font "AMS Manthan"` did nothing: the font was installed, it simply did
   not know what `क` was.
2. **GSUB/GPOS shaping tables exist.** Devanagari is an abugida, not a list of
   letters: `क`+`्`+`ष` must be rewritten into the `क्ष` ligature, and `ि`
   is *after* its consonant in bytes but *before* it on screen. That rewriting
   is done by the shaping engine reading these tables. Fonts here were made
   with Fontographer 4.1.5 (2000) and have none — so even with a fixed cmap,
   every conjunct would break.
3. **The text encoding matches the font's expectation.** Track B fonts predate
   Unicode for Nepali: you were never meant to type Devanagari, you typed
   ASCII and the font's ASCII glyphs *were drawn as* Devanagari, laid out in
   byte order. They are an encoding, not just a font.

A font failing (1) or (2) while still "installed" is the whole reason this
was hard. Run the survey instead of guessing:

```bash
python scripts/font_survey.py "path/to/fonts" "another/folder"
```

Prints `UNICODE-OK` / `UNICODE-NO-SHAPING` / `LEGACY` per file, with Devanagari
coverage, Latin coverage, GSUB/GPOS presence and the name-table licence.

---

## Track A — verified Unicode fonts

Surveyed 2026-09-29. Every file was **parsed with fontTools and its tables
read** — never trusted because of its filename. Source: the
[google/fonts](https://github.com/google/fonts) repo, so these are the real
bytes, not a third-party mirror.

| Family | Devanagari | GSUB | GPOS | Verdict |
|---|---|---|---|---|
| Noto Sans Devanagari | **128/128** | yes | yes | UNICODE-OK |
| Noto Serif Devanagari | **128/128** | yes | yes | UNICODE-OK |
| Yantramanav | **128/128** | yes | yes | UNICODE-OK |
| Tiro Devanagari Hindi | **128/128** | yes | yes | UNICODE-OK |
| Mukta | 127/128 | yes | yes | UNICODE-OK |
| Martel | 122/128 | yes | yes | UNICODE-OK |
| Halant | 102/128 | yes | yes | UNICODE-OK |
| Hind | 94/128 | yes | yes | UNICODE-OK |
| Kalam (handwriting) | 94/128 | yes | yes | UNICODE-OK |

All SIL Open Font License 1.1 — free for commercial and broadcast use, which
matters because these videos go out with the band.

**Using one:** install it system-wide, then

```bash
node render.mjs <audio> <lrc> --font "Mukta"
```

No transcoding step. The `.lrc` stays Unicode and stays valid for AbleSet —
that is the main advantage over Track B.

**Not verified:** Anek Devanagari — the download timed out during the survey,
not a defect in the font. Re-run `scripts/font_survey.py` on it before
trusting it.

---

## Track B — the `01 Fonts` collection

Surveyed `D:\DB Project\...\Final\01 Fonts` (15 unique TTFs).

**Every one of them: 0 Devanagari codepoints, 91–95 ASCII, no GSUB, no GPOS.**
`Abhinav`, `Ananda Fanko 2`, `PawanG`, `Sapana`, `AMS Aakash`, `AMS Aakul 4`,
`AMS Aakul 5`, `AMS BadHand`, `AMS Calligraphy 9`, `AMS Chandrakant`,
`AMS Chhatrapati`, `AMS Dipanshu`, `AMS Handwriting 3`, `AMS Manoja`,
`AMS Manthan`.

They are usable, but only through Track B — which is the path that produced
the Allare render:

```bash
node render.mjs <audio> <lrc> --legacy-font Abhinav.TTF
```

`render.mjs` then transcodes the lyrics via `scripts/lrc_legacy.py`
(`--layout Preeti`), copies the `.ttf` into `public/fonts/`, and
`LyricOverlay.jsx` registers it through the FontFace API with `delayRender`.
A bare CSS `font-family` is **not** enough for these: Chromium sandbox
profiles will not reliably resolve them by name, which is what made
`--font "AMS Manthan"` look broken when the real fault was upstream.

### ⚠️ Preeti is NOT a safe default for these fonts

The command above works **because Abhinav happens to be a Preeti font.** Most
of the folder is not. Feeding Preeti keys to `ams.manthan.ttf` renders exactly
what Track B is supposed to prevent: glyphs collapsed onto each other and a
literal `==` where the danda should be. AMS Manthan is a Kantipur-style
layout — `k` / `Ka` / `ga`, nothing like Preeti's `s` / `v` / `u`.

`lrc_legacy.py` knows five layouts (Preeti, Sagarmatha, Kantipur, PCS NEPALI,
FONTASY_HIMALI_TT). Which one any given font speaks is not recorded anywhere —
the font cannot say, because it has no Unicode cmap and no GSUB, and reading
the meaning off glyph outlines has already been shown to be unreliable.

### Generating a layout for the rest

[anepali.com](https://www.anepali.com) publishes a character table per font —
each cell is a key, drawn in that font, under a Devanagari category heading —
so a font's layout can be **read** rather than guessed. The tooling lives in
[mhzsajan/nepali-legacy-fonts](https://github.com/mhzsajan/nepali-legacy-fonts)
and is vendored into `scripts/`:

```bash
# 1. generate the font's own layout, validated against the real .ttf
py scripts/anepali_charmap.py ams-manthan --font "path/to/ams.manthan.ttf" --out layouts/ams-manthan.json

# 2. render with it
node render.mjs <audio> <lrc> --legacy-font ams.manthan.ttf --layout-file layouts/ams-manthan.json
```

The slot order is calibrated off the Preeti page, where `npttf2utf` is ground
truth, and the calibration is **asserted** (13/13 vowels, 36/36 consonants,
10/10 numbers, 13/13 matras, all distinct) so a change to the site fails
loudly instead of producing a plausible but wrong map.

**Verified: AMS Manthan** now renders correctly. Verify any new font with one
frame before shipping — `--prepare-only` then `remotion still` takes seconds
rather than a full render:

```bash
node render.mjs <audio> <lrc> --legacy-font <f>.ttf --layout-file layouts/<f>.json --prepare-only
npx remotion still src/index.js LyricOverlay out/check.png --frame=5900 --props=out/props.json
```

Notes:

- **`Abhinav` is the proven one** — 35/35 lines round-tripped through
  `npttf2utf`, rendered and eyeballed at 1080p. `ams.manthan` is the second,
  via a generated map.
- **`npttf2utf` must be installed.** `layout_encoder.py` loads its five
  layouts from the package's `map.json`; without it `--legacy-font` dies with
  a bare `FileNotFoundError` on that path.
- `npttf2utf`'s Preeti map has no key for `फ`; `lrc_legacy.py` patches it with
  `km` (`KEY_FIXES`). Loud `!! not round-trip exact` on stderr means a word
  needs a manual fix — do not ship it silently.
- **Symbols are deliberately not mapped.** aNepali publishes them, but the
  same slots hold different characters on different pages, and a legacy font
  already keeps its Devanagari punctuation on the ASCII codepoints, so
  punctuation passes through the transcoder untouched. Mapping it twice is
  what produced the literal `==`.

---

## Why not just convert the fonts?

Rebuilding one means writing a Unicode cmap **and** authoring GSUB/GPOS
ligatures, with no ground truth to check the result against — and a visual
transcription of a legacy key map was already shown to be unreliable
(द/ध, श/ष confusion). Converting the *text* back into the encoding the font
already speaks needs neither, and that is why Track B works today.

For a new project, prefer Track A: a real Unicode font needs none of this.
