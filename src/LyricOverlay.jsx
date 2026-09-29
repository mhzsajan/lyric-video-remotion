import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig, delayRender, continueRender } from "remotion";
import { styleFor, jitterFor, positionFor, sizeFor } from "./animations.js";
import { buildMixPlan } from "./mix.js";
import { widthEm } from "./width-model.mjs";
import { wordTimings } from "./word-timing.js";
import { splitGraphemes, letterSizePct } from "./letters.js";
import { TitleCard } from "./TitleCard.jsx";
import { AUDIO_FILE, LEGACY_FONT_FILE, LEGACY_FONT_FAMILY, FONT_FILE, FONT_FAMILY_NAME } from "./lyrics.generated.js";

// Two ways a font gets here, and the difference between them is the whole
// point of this file.
//
//   FONT_FILE       a local .ttf registered under a name we choose. Used for
//                   BOTH kinds of font, because the CSS font-family stack
//                   cannot name a font that is not installed, and a font file
//                   on disk is not installed.
//   LEGACY_FONT_FILE the same thing, but the lyrics have already been
//                   transcoded to Preeti key sequences, so this is a font whose
//                   text is NOT the Devanagari in the .lrc.
//
// FONT_FILE is the interesting one: it is how a distinctive Devanagari face is
// used WITHOUT a layout file. The "custom font" look does not require a legacy
// font -- it requires a typeface that is not the system default. There are 58
// Unicode Devanagari fonts in nepali-legacy-fonts, many of them display faces,
// and a Unicode font is handed the lyrics unchanged, so there is no key layout
// that can render the wrong letters. A legacy font is the only thing that
// carries that risk, and it is the only thing that needs transcoding.
if (FONT_FILE) {
  const handle = delayRender(`font: ${FONT_FAMILY_NAME}`);
  const face = new FontFace(
    FONT_FAMILY_NAME,
    `url('${staticFile("fonts/" + FONT_FILE)}') format('truetype')`,
    {}
  );
  face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded);
      continueRender(handle);
    })
    .catch((err) => {
      // A font that will not load renders the fallback, which is a valid-looking
      // video in the wrong typeface. Say so: the frame is otherwise fine and
      // nothing else reports it.
      console.error(`Font failed to load: ${FONT_FAMILY_NAME} (${FONT_FILE})`, err);
      continueRender(handle);
    });
}

if (LEGACY_FONT_FILE) {
  // Legacy Preeti-era fonts (AMS/Ananda/Abhinav): load the actual .ttf through
  // the FontFace API -- a bare CSS font-family cannot name these fonts reliably
  // across Chromium sandbox profiles, but explicit bytes always register. The
  // FILE is copied into public/fonts by render.mjs; text arrives pre-converted
  // to Preeti key sequences (scripts/lrc_legacy.py), which these fonts map to
  // their real Devanagari glyphs.
  const handle = delayRender(`legacy font: ${LEGACY_FONT_FAMILY}`);
  const face = new FontFace(
    LEGACY_FONT_FAMILY,
    `url('${staticFile("fonts/" + LEGACY_FONT_FILE)}') format('truetype')`,
    { weight: "400" }
  );
  face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded);
      continueRender(handle);
    })
    .catch((err) => {
      console.error(`Legacy font failed: ${LEGACY_FONT_FAMILY}`, err);
      continueRender(handle);
    });
}

const FONT_FAMILY =
  LEGACY_FONT_FAMILY ||
  // A --font-file is registered under FONT_FAMILY_NAME and must lead the stack,
  // or the CSS fallback below wins and the render quietly uses the system font
  // instead -- which looks like the flag was ignored rather than like an error.
  (FONT_FILE ? '"' + FONT_FAMILY_NAME + '", ' : "") +
  (process.env.LYRIC_FONT ||
    '"Noto Sans Devanagari", "Nirmala UI", "Microsoft New Tai Lue", "Segoe UI", sans-serif');

// Legacy Preeti text is visual-order ASCII: applying fontWeight 700 makes
// Chromium synthesize fake bold (double-draw smear), and letter-spacing
// breaks the pre-base matra positioning that lives in the glyph order.
const legacyTextStyle = LEGACY_FONT_FAMILY ? { fontWeight: 400 } : {};

// -- random font size (--size-mode phrase|word) -----------------------------
//
// WORD granularity is safe; LETTER granularity is not. Devanagari's
// shirorekha -- the horizontal headline running across the top of a word --
// is one continuous bar. Give two letters of the same word different sizes
// and the bar visibly snaps in half. At a word boundary there is already a
// natural gap in the headline, so sizing whole words changes nothing about
// how the glyphs join. The Preeti key text is safe too: lrc_legacy.py splits
// and rejoins on spaces, so word boundaries survive the conversion.
//
// Word multipliers are expressed as PERCENTAGES of the parent, not pixels,
// so the outgoing line can still be shrunk as a whole (it renders at 0.62 /
// 0.8 of the current size) without its words escaping that scale.
function wordSpans(text, seed, index, amount) {
  return text.split(" ").map((w, i) => (
    <React.Fragment key={i}>
      {i > 0 ? " " : null}
      <span style={{ fontSize: (sizeFor(seed, index, amount, "w" + i) * 100).toFixed(2) + "%" }}>
        {w}
      </span>
    </React.Fragment>
  ));
}

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const easeOut = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const easeIn = (t) => Math.pow(clamp01(t), 3);

const ENTER = 0.34; // seconds
const EXIT = 0.28;

// -- word-by-word animation (--word-anim) ------------------------------------
//
// Each word gets its own start time (src/word-timing.js) and animates in when
// it arrives, so a line is built on screen word by word instead of appearing
// all at once. Words already sung STAY visible -- the line is not wiped after
// the fact, because the audience needs to read the whole line while the next
// one is already coming in.
//
// The per-word style is picked from the same seeded pool as line styles, keyed
// on (seed, cueIndex, wordIndex), so it is deterministic like everything else
// here. The word index is part of the key so words in one line do not all get
// the same animation.
function wordStyleFor(seedText, cueIndex, wordIndex, force) {
  return styleFor(`${seedText}#${cueIndex}`, wordIndex, force);
}

export const WORD_ANIMS = ["off", "reveal", "karaoke", "pulse"];

/**
 * Visual state of one word at time t.
 *
 * @param {string} mode   off | reveal | karaoke | pulse
 * @param {number} start  when this word begins
 * @param {number} end    when the next word begins (== cue end for the last)
 * @param {number} t      current time in seconds
 * @param {object} st     line-level style, reused so the word matches the line
 */
export function wordState(mode, start, end, t, st) {
  if (mode === "off" || !st) return { opacity: 1, transform: "" };

  // st carries the line's shadow/filter, which each word should keep; only the
  // animated properties are overridden below.
  const p = clamp01((t - start) / Math.max(0.05, end - start));

  if (mode === "reveal") {
    // Rise into place quickly, then hold for the rest of the slot.
    const inE = easeOut(clamp01((t - start) / 0.22));
    return { ...st, opacity: inE, transform: `translateY(${(1 - inE) * 14}px)` };
  }

  if (mode === "karaoke") {
    // Brightest at the moment it lands, settling back after: this is what makes
    // the eye follow along the line.
    const inE = easeOut(clamp01((t - start) / 0.18));
    const hot = 1 - p;
    return {
      ...st,
      opacity: inE,
      textShadow: `0 0 ${(10 + hot * 26).toFixed(1)}px rgba(255,255,255,${(0.35 + hot * 0.6).toFixed(2)})`,
    };
  }

  if (mode === "pulse") {
    // A small scale pop as the word lands, nothing after.
    const inE = easeOut(clamp01((t - start) / 0.2));
    return {
      ...st,
      opacity: inE,
      transform: `scale(${(0.9 + 0.1 * inE).toFixed(4)})`,
    };
  }

  return { ...st, opacity: 1, transform: "" };
}

/**
 * Render a cue's words as spans, each animated on its own start time.
 *
 * The line-level style `st` is deliberately NOT applied to the words: it holds
 * the whole-line entrance/exit and a `scale()` in it would fight the per-word
 * transform. The caller keeps it on the wrapping element.
 */
function animatedWords(text, opts) {
  const { seed, index, anim, sizeMode, sizeVar, t, cueTime, cueEnd,
          letterAnim, letterSizeVar } = opts;
  const words = wordTimings({ text, time: cueTime, end: cueEnd });
  if (words.length === 0) return text;

  const amount = Number(sizeVar) || 0;

  return words.map((w, i) => {
    const ws = wordState(
      anim,
      w.start,
      w.end,
      t,
      anim === "off" ? null : cueStyle(wordStyleFor(seed, index, i), 1, 0, 0)
    );
    // When only the letter layer is active there is no per-word animation, so
    // the word span must not carry the line's own opacity/transform or the
    // letters would be animated on top of a second, conflicting transform.
    const pct =
      sizeMode === "word"
        ? (sizeFor(seed, index, amount, "w" + i) * 100).toFixed(2) + "%"
        : null;
    return (
      <React.Fragment key={i}>
        {i > 0 ? " " : null}
        <span
          style={{
            // inline-block so a scale() has its own box to act on; on a plain
            // inline span the transform would apply to the whole line.
            display: "inline-block",
            ...(pct ? { fontSize: pct } : {}),
            ...ws,
          }}
        >
          {letterNodes(w.text, {
            seed, wordIndex: index, letterIndexBase: i,
            letterSizeVar, letterAnim, t, wordStart: w.start, wordEnd: w.end,
          })}
        </span>
      </React.Fragment>
    );
  });
}

// -- per-letter layer (--letter-anim, --letter-var) --------------------------
//
// Sits INSIDE each word span. Letters are grapheme clusters, not codepoints,
// so conjuncts and pre-base matras survive intact -- see src/letters.js for why
// that matters and what breaks otherwise.
//
// Two independent knobs:
//
//   --letter-anim  per-letter animation. Safe at any strength, because a
//                  letter can appear without changing its size.
//   --letter-var   per-letter SIZE. Clamped to LETTER_SIZE_CAP (0.12) because
//                  the shirorekha is continuous across a word: past that, two
//                  letters at different sizes visibly snap the headline in
//                  half and the word stops looking typeset.
export const LETTER_ANIMS = ["off", "fade", "rise", "pop", "wipe"];

/** Visual state of one letter at time t, relative to its word's arrival. */
export function letterState(mode, elapsed, letterIndex) {
  if (mode === "off") return {};

  // Each letter trails the one before it slightly, so a word reads as
  // "unrolling" rather than every letter popping at once.
  const delay = letterIndex * 0.035;
  const p = clamp01((elapsed - delay) / 0.20);
  const inE = easeOut(p);

  if (mode === "fade") return { opacity: inE };
  if (mode === "rise") {
    return { opacity: inE, transform: `translateY(${(1 - inE) * 10}px)` };
  }
  if (mode === "pop") {
    return {
      opacity: inE,
      transform: `scale(${(0.72 + 0.28 * inE).toFixed(4)})`,
    };
  }
  if (mode === "wipe") {
    // Clip each letter in from its own left edge, left to right.
    return { opacity: 1, clipPath: `inset(0 ${((1 - inE) * 100).toFixed(1)}% 0 0)` };
  }
  return {};
}

/**
 * Render one word's letters as spans. Returns the plain string when both
 * letter features are off, so a normal render builds no extra nodes.
 */
function letterNodes(text, opts) {
  const { seed, wordIndex, letterIndexBase, letterSizeVar, letterAnim, t,
          wordStart } = opts;
  const sizeOn = Number(letterSizeVar) > 0;
  const animOn = letterAnim && letterAnim !== "off";
  if (!sizeOn && !animOn) return text;

  const letters = splitGraphemes(text);
  // Nothing to vary in a single grapheme, and animating it would be a no-op.
  if (letters.length < 2) return text;

  const elapsed = t - (wordStart ?? t);
  // letterIndexBase keeps the seed distinct from the word's own key, so the
  // first letter of word 3 does not reuse word 0's values.
  const base = wordIndex * 1000 + letterIndexBase * 100;

  return letters.map((ch, i) => {
    const style = {};
    if (sizeOn) {
      const pct = letterSizePct(letterSizeVar, seed, wordIndex, base + i);
      if (pct) style.fontSize = pct;
    }
    if (animOn) Object.assign(style, letterState(letterAnim, elapsed, i));
    return (
      <span
        key={i}
        style={{
          display: "inline-block",
          ...style,
        }}
      >
        {ch}
      </span>
    );
  });
}

/**
 * Compute the visual state of one cue at time t.
 * Exported so the still/contact-sheet renderer can reuse it without React.
 */
export function cueStyle(style, p, q, j) {
  // p = 0..1 through the entrance, q = 0..1 through the exit, j = 0..1 jitter
  const inE = easeOut(p);
  const outE = easeIn(q);
  const opacity = Math.min(inE, outE);
  const s = { opacity, transform: "", filter: "", clipPath: undefined };

  switch (style) {
    case "rise":
      s.transform = `translateY(${(1 - inE) * 44}px)`;
      break;
    case "pop":
      s.transform = `scale(${0.86 + 0.14 * inE})`;
      break;
    case "slide-left":
      s.transform = `translateX(${(1 - inE) * (90 + j * 50)}px)`;
      break;
    case "slide-right":
      s.transform = `translateX(${(1 - inE) * -(90 + j * 50)}px)`;
      break;
    case "zoom-through": {
      const z = 1.18 - 0.18 * inE;
      s.transform = `scale(${z})`;
      s.opacity = opacity * (0.65 + 0.35 * inE);
      break;
    }
    case "blur-in":
      s.filter = `blur(${(1 - inE) * (10 + j * 8)}px)`;
      s.transform = `scale(${0.97 + 0.03 * inE})`;
      break;
    case "typewriter": {
      // Wipe the text in by clipping from the left, with a slight ease so it
      // does not read as a hard mask.
      const w = 100 * inE;
      s.clipPath = `inset(0 ${(100 - w).toFixed(2)}% 0 0)`;
      break;
    }
    case "glow":
      // The reference-video look: white core with a soft bloom. Text-shadow
      // carries the glow; scale eases from slightly larger (light gathering).
      s.textShadow = `0 0 ${(18 + j * 14).toFixed(1)}px rgba(255,255,255,0.95), 0 0 ${(60 + j * 40).toFixed(1)}px rgba(255,255,255,0.55)`;
      s.transform = `scale(${(1.04 - 0.04 * inE).toFixed(4)})`;
      break;
    case "fade":
    default:
      break;
  }
  return s;
}

export const LyricOverlay = ({ cues, title, band, seed, style, fontSize, color, shadow, position, background, mode, sizeMode, sizeVar, wordAnim, letterAnim, letterVar, titleCard, titleCardOutro, mixBlock, mixPlanSpec, widthModel }) => {
  const frame = useCurrentFrame();
  const { fps, width: W_FRAME, height: H_FRAME } = useVideoConfig();
  const t = frame / fps;
  const master = seed || "song";
  const anim = WORD_ANIMS.includes(wordAnim) ? wordAnim : "off";
  const lAnim = LETTER_ANIMS.includes(letterAnim) ? letterAnim : "off";

  // Active cue = the last one that has started.
  let idx = -1;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].time <= t) idx = i;
    else break;
  }

  // The line just before, drifting away — reads as motion rather than a hard
  // cut. Its own presentation is resolved separately below, which is what turns
  // a change of placement into a cross-fade between two layouts instead of the
  // text jumping.
  const prev = idx > 0 ? cues[idx - 1] : null;
  const prevAge = prev ? t - prev.time : 0;
  const prevSpan = prev ? prev.end - prev.time : 0;
  const prevLife = prevSpan > 0 ? clamp01(prevAge / prevSpan) : 1;

  const roam = mode === "roam";
  const horizontal = mode === "horizontal";
  const vertical = mode === "vertical";

// ---------------------------------------------------------------------------
// PLACEMENT
// ---------------------------------------------------------------------------
//
// --mode is how a line is PLACED on the frame. It is independent of
// --word-anim / --letter-anim, which control how a line is ANIMATED once placed.
//
//   center     (default) lines stack in the middle, the outgoing one drifts up
//   roam       each line gets its own seeded spot (the reference-video look)
//   horizontal one left-aligned band, lines stack downward
//   vertical   one centred narrow column, lines stack downward
//   mix        all of the above, planned across the song (see src/mix.js)
//
// Horizontal exists because roam fights word-by-word animation: in roam each
// line lands somewhere new, so a karaoke sweep makes the audience re-find the
// text every line. Pinned to one band it reads as one continuous left-to-right
// progression. Vertical is the same argument for short lyrics, where a 64vw
// band wastes the frame and a narrow column reads better.
//
// ONE RETURN PATH
// ---------------
// This used to be three, and the third one to be added was vertical -- at
// which point every future path was a chance to leave something out of one of
// them. That already happened once: `<Audio>` was only in the centre path, so
// every `--mode roam` render came out silent while still exiting 0. Silent and
// the right length is easy to ship, because nothing in the output says "no
// audio". So there is ONE return path now and placement is a per-cue property.
// If you add a placement, add it to geometry() -- there is nowhere else it can
// go wrong.
const MODE_DEFAULT_UNIT = "word";

/**
 * Where a block of text sits, for one placement.
 *
 * Numbers, not "64vw": the auto-fit below does arithmetic on the width to
 * count how many lines a cue wraps to, and "64vw" * 19.2 is NaN -- every
 * comparison against NaN is false, so the fit silently did nothing and the
 * clipped line stayed clipped. The unit is added at the point of use.
 *
 * The vertical values put banded text in the LOWER half. This is lyrics over a
 * camera feed, so the text has to clear a performer's head and shoulders,
 * which occupy the middle of frame. `center` = 56% is not the middle of the
 * frame and is not meant to be: the band TOP is at 56%, so one line sits around
 * 56-70% and a wrapped one 56-80%, both in the lower third where subtitle
 * convention puts them.
 */
function geometry(place, position, W, H) {
  const top = { top: 24, center: 56, bottom: 70 }[position || "center"];
  switch (place) {
    case "horizontal":
      return { kind: "band", left: 11, width: 64, top, align: "left", prevScale: 0.7 };
    case "vertical":
      // Narrow enough that a long line stacks into a readable column instead
      // of a single 84vw row, wide enough that the longest Allare cue (50
      // characters) does not become eight lines tall.
      return { kind: "band", left: 25, width: 50, top, align: "center", prevScale: 0.72 };
    case "center":
      // Centred on the frame rather than hung from a fixed top, which is what
      // the flexbox version did and what "center" means.
      return { kind: "centre", left: 8, width: 84, top: 50, align: "center", prevScale: 0.62 };
    case "roam":
    default:
      return { kind: "roam", align: "center", prevScale: 0.8 };
  }
}

/** The per-cue presentation, honouring --mode mix. */
const mixPlan =
  mode === "mix"
    ? buildMixPlan({ seed: master, cueCount: cues.length, block: Number(mixBlock) || 8, spec: mixPlanSpec || "" })
    : null;

// A non-mix mode is a one-entry plan repeated, so there is exactly one code path
// that knows what a cue should look like -- not two that have to agree.
const presentationAt = (cueIndex) => {
  if (mixPlan && mixPlan[cueIndex]) return mixPlan[cueIndex];
  if (mixPlan && mixPlan.length) return mixPlan[0];
  const place = roam ? "roam" : horizontal ? "horizontal" : vertical ? "vertical" : "center";
  return { id: place, place, unit: MODE_DEFAULT_UNIT, block: 0 };
};

const frameStyle = {
  // "transparent" = alpha overlay (mov / ProRes 4444). A colour like
  // "#000000" = keyable plate for containers without alpha (mp4): the
  // consumer sets the layer blend to Add/Screen so black disappears.
  backgroundColor: background || "transparent",
  padding: "0 8vw",
};

// The opening and closing cards sit under the lyrics, so z-order is a non-issue
// and there is only one place they have to be remembered.
const opener = titleCard || titleCardOutro ? (
  <TitleCard
    t={t}
    firstLyric={cues.length ? cues[0].time : NaN}
    lastLyricEnd={cues.length ? cues[cues.length - 1].end : NaN}
    title={title}
    band={band}
    color={color}
    anyway={!!titleCard && titleCard !== "no"}
    outro={!!titleCardOutro}
  />
) : null;

// The song, so the finished file syncs against its own audio with no external
// reference. This is inside the ONE return path, which is the only reason it
// cannot go missing from a mode again.
const song = AUDIO_FILE ? <Audio src={staticFile(AUDIO_FILE)} /> : null;

if (idx < 0) {
  return (
    <AbsoluteFill style={{ ...frameStyle, alignItems: "center", justifyContent: "center" }}>
      {song}
      {opener}
    </AbsoluteFill>
  );
}

const cue = cues[idx];
const since = t - cue.time;
const until = cue.end - t;

// -- AUTO-FIT ---------------------------------------------------------------
//
// A long line wraps, and a wrapped block grows DOWNWARD from a fixed top, so a
// three-line line runs off the bottom of the frame. Measured on Allare: the
// longest cue is 50 characters, and at 128px in a 64vw band it wraps to three
// lines, the last of which is clipped -- text half off the screen, with no
// error anywhere.
//
// The renderer cannot measure text while it renders, so the width is predicted
// from a per-font table of coefficients, which scripts/calibrate_width.mjs fits
// by rendering sample lines in the browser and measuring the ink they leave.
// The classification is in src/width-model.mjs, shared with the calibration so
// the two cannot drift.
//
// The three earlier attempts at this, and what each got wrong:
//
//   0.55em per code point     a Preeti font is ~0.48em per code point, so every
//                             legacy line was predicted to wrap when it does
//                             not and got shrunk ~28% for nothing
//   0.7153em, the mean of     counting matras as full-width. Shaping reorders
//     the whole Devanagari    a pre-base matra into space its consonant owns,
//     block                   so the real cost is 0.334em per code point. This
//                             one predicted THREE lines for a line the browser
//                             draws on ONE and shrank it to 75%
//   0.7480em, the mean of     narrow spaces averaged in with wide consonants
//     consonants only
//
// Falls back to the per-class defaults when no table is supplied, so a still
// rendered from an old props file still lays out rather than becoming NaN.
const widthTable =
  widthModel && typeof widthModel === "object" ? widthModel : null;

// SAFETY MARGIN. The model is fitted from measurements, so it is a little wrong
// in both directions, and the two directions are not equally bad. Under-
// predicting width means the chosen size needs one line more than the budget
// allows, and the last line runs off the bottom of the frame -- text half off
// the screen, which is the failure this whole thing exists to prevent.
// Over-predicting only costs a little size. So the width is inflated before the
// decision, and the error is spent on size rather than on clipping.
//
// 8% is measured, not guessed: the leave-one-out error on the lines that
// actually wrap is 1-6% on Allare (see scripts/calibrate_width.mjs), so 8% sits
// just outside it.
const WRAP_MARGIN = 1.08;

const fit = (text, size, bandWidth) => {
  const bandPx = bandWidth * (W_FRAME / 100);
  const w = widthEm(text, widthTable) * WRAP_MARGIN;
  const linesFor = (px) => Math.max(1, Math.ceil((w * px) / bandPx));
  // The budget covers the current line AND the outgoing one above it, since
  // both occupy the band at once.
  const budget = H_FRAME * 0.34;
  const needAt = (px) => linesFor(px) * px * 1.32;
  if (needAt(size) <= budget) return size;
  // Bisect rather than dividing once: the line count is a step function of the
  // size, so the obvious size * (budget / need) can land on a size that still
  // needs one line too many. It did, and the text stayed clipped.
  let lo = 8;
  let hi = size;
  for (let i = 0; i < 18 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    if (needAt(mid) <= budget) lo = mid;
    else hi = mid;
  }
  return lo;
};

/**
 * Render one cue, positioned and sized for its presentation.
 *
 * `age` is how far through its own life the cue is, 0..1, used for the exit
 * fade. `isPrev` shrinks and fades the outgoing line, which is what makes a
 * change of placement read as the old layout dissolving rather than as a jump
 * cut: the outgoing line is drawn in ITS OWN presentation, resolved
 * independently, so a block boundary is a cross-fade between two layouts
 * instead of the text teleporting.
 */
function renderCue(cueObj, isPrev, life) {
  const pres = presentationAt(cueObj.index);
  const g = geometry(pres.place, position, W_FRAME, H_FRAME);

  const unitIsWord = pres.unit === "word";
  // Per-letter and per-word features need the word spans to exist, because the
  // letters nest inside them. Phrase presentations deliberately do not use them:
  // "the whole line arrives at once" is the point of the phrase unit, and
  // popping the letters one at a time would be the word unit wearing a
  // different hat.
  const spans = unitIsWord && (anim !== "off" || lAnim !== "off" || Number(letterVar) > 0);

  let size = fontSize;
  if (spans) {
    // animatedWords() renders the spans at the parent's size and carries the
    // variation internally, so the outer size is the base.
  } else if (sizeMode === "phrase") {
    size = fontSize * sizeFor(master, cueObj.index, Number(sizeVar) || 0);
  } else if (sizeMode === "word" && !spans) {
    size = fontSize;
  }
  if (isPrev) size *= g.prevScale;

  const content = spans
    ? animatedWords(cueObj.text, {
        seed: master, index: cueObj.index, anim, sizeMode, sizeVar, t,
        cueTime: cueObj.time, cueEnd: cueObj.end, letterAnim, letterSizeVar: letterVar,
      })
    : sizeMode === "word"
      ? wordSpans(cueObj.text, master, cueObj.index, Number(sizeVar) || 0)
      : cueObj.text;

  // Banded and centred placements have a bounded width, so they wrap and need
  // the fit. Roam does not: its anchor is already chosen so a 60vw block fits,
  // and fitting it would shrink roam relative to every other mode.
  const bandWidth = g.kind === "roam" ? 60 : g.width;
  const shown = g.kind === "roam" ? size : fit(cueObj.text, size, bandWidth);

  const base = {
    fontFamily: FONT_FAMILY,
    fontWeight: 700,
    ...(LEGACY_FONT_FAMILY ? { fontWeight: 400 } : {}),
    color,
    textShadow: shadow,
    fontSize: shown,
    lineHeight: 1.32,
    textAlign: g.align,
    whiteSpace: "pre-wrap",
    margin: 0,
    ...(g.kind === "roam" ? { maxWidth: "60vw" } : {}),
  };

  // The entrance/exit transform goes on an INNER element. Putting it on the
  // positioned box let glow's scale() overwrite the box's own translate(-50%,
  // -50%) and the block hung off the right edge of the frame; the same
  // overwrite took the band's top offset with it.
  const inner = { ...cueStyle(pickedFor(cueObj.index), since / ENTER, until / EXIT, jitterFor(master, cueObj.index)), display: "inline-block" };

  const box =
    g.kind === "roam"
      ? (() => {
          const p = positionFor(master, cueObj.index);
          return {
            position: "absolute",
            left: p.x + "%",
            top: p.y + "%",
            transform: "translate(-50%, -50%)",
          };
        })()
      : {
          position: "absolute",
          left: g.left + "vw",
          width: g.width + "vw",
          top: g.top + "%",
          // Only the centred placement translates; the bands hang from a fixed
          // top so a wrapped block grows downward predictably.
          ...(g.kind === "centre" ? { transform: "translateY(-50%)" } : {}),
        };

  // The outgoing line's own exit, which differs by placement: banded layouts
  // drift, roam dissolves in place (that is the reference video's measured
  // behaviour) and centre drifts up by a fixed amount.
  const exit = isPrev
    ? g.kind === "roam"
      ? {}
      : g.kind === "centre"
        ? { transform: `translateY(${-life * 30}px)` }
        : {}
    : {};

  return (
    <div style={{ ...base, ...box, ...exit, opacity: isPrev ? (1 - life) * 0.55 : undefined }}>
      <div style={inner}>{content}</div>
    </div>
  );
}

/** The entrance style for a cue, resolved the same way for it and its predecessor. */
function pickedFor(cueIndex) {
  return styleFor(master, cueIndex, style);
}

return (
  <AbsoluteFill style={frameStyle}>
    {song}

    {/* The outgoing line is drawn first, so the current line paints over it in
        the one frame where both are visible. Each is placed by its OWN
        presentation, which is what makes a block boundary a cross-fade between
        layouts instead of a jump. */}
    {prev && prevLife < 1 ? renderCue(prev, true, prevLife) : null}
    {renderCue(cue, false, 0)}

    {opener}
  </AbsoluteFill>
);
};
