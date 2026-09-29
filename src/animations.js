// Seeded, deterministic animation selection.
//
// WHY THIS IS SEEDED, NOT Math.random():
// You render this once and then use the file live. If the animation were
// random per render, the same song would come out different every time and
// your show file would stop matching the video. So every cue's style is
// derived from (masterSeed, cueIndex) — stable across renders, machines and
// re-runs, but still varied line to line so it does not feel mechanical.

/** mulberry32 — small, fast, good enough distribution for style picking. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const STYLES = [
  "fade",
  "rise",
  "pop",
  "slide-left",
  "slide-right",
  "typewriter",
  "blur-in",
  "zoom-through",
  "glow",
];

/**
 * Pick a style for one cue. Deterministic for a given (seed, index).
 * @param {string} seedText  master seed — usually the song title
 * @param {number} index     cue index
 * @param {string} [force]   pin every cue to one style
 */
export function styleFor(seedText, index, force) {
  if (force && STYLES.includes(force)) return force;
  const rnd = seededRandom(hashString(String(seedText)) + index * 2654435761);
  return STYLES[Math.floor(rnd() * STYLES.length) % STYLES.length];
}

/** Per-cue jitter so timings are not perfectly uniform frame to frame. */
export function jitterFor(seedText, index) {
  const rnd = seededRandom(hashString("jit:" + seedText) + index * 40503);
  return rnd();
}

/**
 * Deterministic position for one cue in "roam" mode: each line appears at its
 * own spot (measured from the reference video the user loved: positions vary
 * line to line, biased to the upper two-thirds, x anywhere, never the bottom
 * edge). Same seed -> same layout, every render.
 */
export function positionFor(seedText, index) {
  const rnd = seededRandom(hashString("pos:" + seedText) + index * 2246822519);
  // x: width-safe band. The block is CENTERED on this anchor with a
  // maxWidth of 60vw, so an anchor below 32% (or above 68%) can push a
  // full-width line past the frame edge -- "Ritu"'s long chorus lines
  // clipped 100+ px off the left at x=20%. Keeping the anchor in the
  // middle 36% guarantees both edges of a 60vw block stay on-screen; it
  // also keeps every position meaningfully off-center, which reads better
  // than a hard clamp piling cues at 12%.
  const x = 32 + rnd() * 36;          // 32%..68% from left
  // y: upper two-thirds, top-safe. Reference never put text in the bottom
  // third. Band starts at 24% because a wrapped 2-line block (fontSize
  // 13vh x 1.32 lineHeight x 2 = ~34vh) centered on a lower anchor pushed
  // its top through the frame edge -- "Ritu"'s held chorus line lost
  // 1000+ px of glow into the top 3 rows at y=19.6%. 24% covers the
  // 2-line worst case (17vh half-height + glow); no song cue wraps to 3.
  const y = 24 + rnd() * 42;           // 24%..66% from top
  return { x, y };
}

/**
 * Deterministic font-size multiplier in [1-amount, 1+amount].
 *
 * This is the random font size (--size-mode phrase|word). Two things decide
 * how wide it may go:
 *
 *   - It must be NARROW. The point is that a line breathes, not that words
 *     shout at the audience, so amount is clamped to 0.45 (55%..145%). Past
 *     that the small words stop being readable at 1080p and the big ones
 *     collide with the frame edge.
 *   - It must be SEEDED, like every other choice here, so re-rendering the
 *     show file produces the same layout.
 *
 * @param {string} seedText  master seed — usually the song title
 * @param {number} index     cue index
 * @param {number} amount    max deviation from 1.0; 0 means no variation
 * @param {string} [salt]    distinguishes words inside one cue ("w0", "w1"...)
 */
export function sizeFor(seedText, index, amount, salt = "") {
  const a = Math.min(Math.max(Number(amount) || 0, 0), 0.45);
  if (!a) return 1;
  const rnd = seededRandom(
    hashString("size:" + salt + "|" + seedText) + index * 374761393
  );
  return 1 - a + rnd() * 2 * a;
}

export { seededRandom, hashString };
