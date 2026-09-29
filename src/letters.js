// Letter-level splitting, for per-letter animation and size.
//
// WHY GRAPHEMES, NOT CODEPOINTS
// -----------------------------
// A Devanagari letter is not one character. "क्ष" is three codepoints (क U+0915,
// ् U+094D virama, ष U+0937) that together form ONE glyph. "नि" is two: the
// ि is a pre-base matra that is drawn to the LEFT of the consonant, though it
// is stored after it. Splitting either on raw codepoints produces visible
// garbage -- a broken headline and a matra sitting in the wrong place.
//
// Intl.Segmenter with granularity "grapheme" already knows these rules; it is
// in Node and in Chromium, so no dependency is needed. Verified behaviour:
//
//   क्ष -> 1 grapheme      हावा -> 2      सँगै -> 2
//   नि  -> 1 grapheme      त्र  -> 1      आउँछु -> 3
//
// THE SHIROREKHA CAVEAT -- READ BEFORE USING PER-LETTER SIZE
// ----------------------------------------------------------
// Devanagari's headline bar (shirorekha) is continuous ACROSS a word. Give two
// graphemes inside one word different font sizes and the bar visibly steps at
// the boundary -- the word stops looking typeset and starts looking broken.
//
// Word boundaries are safe because there is already a gap in the bar there.
// Inside a word there is not. So per-letter SIZE is offered but clamped far
// tighter than per-word size (see LETTER_SIZE_CAP below), and per-letter
// ANIMATION is safe at any strength because a letter can appear without
// changing its size.
//
// This is a real constraint of the script, not a limitation of the renderer --
// the same thing happens in any typesetting app that lets you size two letters
// of a Devanagari word differently.

/** Split text into grapheme clusters, keeping conjuncts and matras intact. */
export function splitGraphemes(text) {
  const s = String(text ?? "");
  if (!s) return [];
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const seg = new Intl.Segmenter("ne", { granularity: "grapheme" });
    return [...seg.segment(s)].map((x) => x.segment);
  }
  // Fallback: Array.from splits by codepoint, which is wrong for Devanagari
  // but better than crashing. Node 16+ and Chromium both have Segmenter, so
  // this is a safety net, not the expected path.
  return Array.from(s);
}

// Per-letter size variation is capped hard, far below --size-var's 0.45.
//
// This number was measured, not guessed. Rendering the same line at five values
// and inspecting the headline at 3x zoom:
//
//   0     one continuous bar (control)
//   0.03  bar still continuous, letters differ subtly      <- safe ceiling
//   0.05  bar starts to separate
//   0.08  bar clearly broken into segments
//   0.12  bar badly broken, the word looks damaged
//
// The failure is very visible because the shirorekha is the single strongest
// horizontal feature in the glyph. 0.12 was the first guess here and it was
// wrong; 0.05 is already enough to read as a mistake. 0.03 gives texture with
// the headline intact.
export const LETTER_SIZE_CAP = 0.03;

/**
 * How a letter's size differs from its parent word.
 * @param {number} amount max deviation, already clamped by the caller
 * @param {string} salt    seed salt, so letters vary independently
 */
export function letterSizePct(amount, seed, index, letterIndex) {
  if (!(amount > 0)) return null;
  const clamped = Math.min(amount, LETTER_SIZE_CAP);
  const v = seededUnit(`${seed}:L${index}`, letterIndex);
  return ((1 - clamped + v * clamped * 2) * 100).toFixed(2) + "%";
}

// Small local PRNG so this module stays dependency-free and does not import
// the renderer's animations.js (which is React-adjacent). Same mulberry32.
function seededUnit(salt, n) {
  let a = 2166136261 ^ salt.length;
  for (let i = 0; i < salt.length; i++) {
    a ^= salt.charCodeAt(i);
    a = Math.imul(a, 16777619);
  }
  a = (a + Math.imul(n + 1, 2654435761)) | 0;
  a = Math.imul(a ^ (a >>> 15), 1 | a);
  a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
  return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
}
