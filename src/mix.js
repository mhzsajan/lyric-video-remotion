// mix.js -- the plan for a video that does not look the same all the way through.
//
// WHY THIS EXISTS
// ---------------
// --mode is one value for the whole video. Asking for "horizontal" gives 109
// cues of horizontal, which is legible and completely monotonous, and asking
// for "roam" gives 109 cues of a different monotony. Neither is what a lyric
// video wants: the eye wants the text to move, but it wants to know WHERE it
// is.
//
// So a presentation here is two independent choices, and this module plans
// them across the song:
//
//   placement   horizontal | vertical | center | roam
//   unit        word (karaoke, one word at a time) | phrase (whole line)
//
// Four placements x two units = eight presentations, which between them are
// the vertical and horizontal layouts and the word-by-word and
// phrase-by-phrase timings the user asked for.
//
// WHY A DECK, NOT A RANDOM PICK AND NOT A FIXED STRIDE
// -----------------------------------------------------
// Same reason as everything else in this renderer: the video is rendered once
// and then used live, so the same command has to produce the same file.
//
// A plain random pick is worse than useless here for a second reason -- it can
// pick the same presentation thirty times running, or never pick `vertical` at
// all, and both look like a bug rather than a choice.
//
// A fixed stride over the list looked right and was not. Nudging a colliding
// pair forward by one fixed it locally and broke the global guarantee: the
// nudged slot is then never dealt, so on Allare `r-word` and `c-word` were
// missing from the entire 109-cue video, with no error and no visible cause --
// the walk simply had a hole where the nudge had been.
//
// So the plan is a DECK instead: all eight presentations, ordered so that no
// two neighbours share a placement, dealt out one per block and reshuffled
// from a fixed seed. Every presentation appears exactly once per eight blocks,
// by construction rather than by luck, and no two neighbouring blocks stutter.
import { hashString, seededRandom } from "./animations.js";

export const PLACEMENTS = ["horizontal", "vertical", "center", "roam"];
export const UNITS = ["phrase", "word"];

/**
 * The eight presentations. The ORDER matters: no two neighbours here share a
 * placement, including the last wrapping back to the first, which is what makes
 * this list a valid deck on its own and therefore a safe fallback when the
 * shuffle retries run out.
 *
 *   h  v  r  c  h  v  c  r
 *   word phrase word phrase phrase word phrase phrase
 */
export const PRESENTATIONS = [
  { id: "h-word", place: "horizontal", unit: "word" },
  { id: "v-phrase", place: "vertical", unit: "phrase" },
  { id: "r-word", place: "roam", unit: "word" },
  { id: "c-phrase", place: "center", unit: "phrase" },
  { id: "h-phrase", place: "horizontal", unit: "phrase" },
  { id: "v-word", place: "vertical", unit: "word" },
  { id: "c-word", place: "center", unit: "word" },
  { id: "r-phrase", place: "roam", unit: "phrase" },
];

export const PRESENTATION_IDS = PRESENTATIONS.map((p) => p.id);

/** "h-word" -> { id, place, unit }. Unknown ids are an error, not a default. */
export function presentationFor(id) {
  const p = PRESENTATIONS.find((x) => x.id === id);
  if (!p) {
    throw new Error(
      'Unknown presentation "' + id + '". Use: ' + PRESENTATION_IDS.join(", ")
    );
  }
  return p;
}

/**
 * True when no two neighbours in the list share a placement, INCLUDING the
 * wrap from the last entry to the first. The wrap is the part that is easy to
 * forget and it is the one that bites at the end of every eight blocks, which
 * is the most visible place in the song to have a stutter.
 */
function alternates(list) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].place === list[(i + 1) % list.length].place) return false;
  }
  return true;
}

if (!alternates(PRESENTATIONS)) {
  // A module-level throw beats a subtly worse video. Reordering the list to
  // fix this is safe; the order is presentation choice, not data.
  throw new Error(
    "mix.js: PRESENTATIONS must alternate placements, including last-to-first. " +
      "Reorder the list; the deck depends on it."
  );
}

/**
 * A seeded ordering of all eight presentations with no two neighbours sharing a
 * placement. Retries a shuffle rather than repairing one, because a repair can
 * reintroduce the collision it just fixed two positions along.
 *
 * Falls back to the declared order, which alternates() has already proved is
 * valid -- so this cannot fail, and cannot return a deck that drops a
 * presentation.
 */
function buildDeck(rnd) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const d = PRESENTATIONS.slice();
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = d[i];
      d[i] = d[j];
      d[j] = t;
    }
    if (alternates(d)) return d;
  }
  return PRESENTATIONS.slice();
}

/**
 * Plan for a whole song: one presentation per cue.
 *
 * @param {object} o
 * @param {string} o.seed      master seed (song title) -- same seed, same plan
 * @param {number} o.cueCount
 * @param {number} [o.block]   cues per presentation, default 8
 * @param {string} [o.spec]    explicit plan, overrides the walk entirely
 * @returns {Array<{id,place,unit,block}>}
 */
export function buildMixPlan({ seed, cueCount, block = 8, spec = "" } = {}) {
  const n = Math.max(0, Number(cueCount) || 0);
  if (!n) return [];

  if (spec) return parsePlan(spec, n);

  // A block of 1 would change the layout on every single cue, which is not
  // "variety", it is a flicker: at Allare's median 1.4s per line the text
  // never settles long enough to be read. 4 is the floor.
  const per = Math.max(4, Math.floor(Number(block) || 8));

  // Seeded, so two songs do not open on the same presentation, and so the
  // same song always deals the same deck.
  const rnd = seededRandom(hashString("mix:" + String(seed)));
  const deck = buildDeck(rnd);

  const plan = [];
  for (let i = 0; i < n; i++) {
    const b = Math.floor(i / per);
    plan.push({ ...deck[b % deck.length], block: b });
  }
  return plan;
}

/**
 * An explicit plan, so a specific verse can be pinned:
 *   "0-7:h-word,8-15:v-phrase,16+:*"
 * Ranges are CUE INDICES, 0-based, inclusive. `16+` means "to the end" -- note
 * that it has no dash, which is the whole point of the `+` form, so the parser
 * has to accept it without one. Later entries win, so a short override can sit
 * on top of a long one.
 *
 * An explicit plan is honoured EXACTLY, including adjacent repeats. The
 * automatic walk nudges same-placement neighbours apart because it is choosing
 * for you; a plan is you choosing, and second-guessing it would mean the log
 * and the file disagree.
 */
export function parsePlan(spec, cueCount) {
  const plan = new Array(cueCount).fill(null);
  for (const part of String(spec).split(",")) {
    const chunk = part.trim();
    if (!chunk) continue;
    // Either "from-to" or "from+", then a colon and an id.
    const m = /^(\d+)\s*(?:-\s*(\d+)|(\+))\s*:\s*([a-z*][a-z-]*)$/i.exec(chunk);
    if (!m) {
      throw new Error(
        'Bad --mix-plan chunk "' + chunk +
          '". Expected e.g. 0-7:h-word, 8-15:v-phrase, 16+:*'
      );
    }
    const from = Number(m[1]);
    const to = m[2] !== undefined ? Number(m[2]) : cueCount - 1;
    const id = m[4].toLowerCase();
    const p = id === "*" ? null : presentationFor(id);
    for (let i = Math.max(0, from); i <= Math.min(to, cueCount - 1); i++) {
      plan[i] = p;
    }
  }
  // Any gap the spec did not cover falls back to the automatic walk, so a
  // three-line override is a valid thing to write.
  return plan.map((p, i) => ({ ...(p || PRESENTATIONS[i % PRESENTATIONS.length]), block: i }));
}

/**
 * A human-readable summary of a plan, for the render log. Without it a mixed
 * video is unreproducible by eye: you cannot tell from the file which block was
 * meant to be which, and "it looked wrong" has nothing to point at.
 */
export function describePlan(plan) {
  const out = [];
  let start = 0;
  for (let i = 1; i <= plan.length; i++) {
    if (i === plan.length || plan[i].id !== plan[start].id) {
      const a = start + 1;
      const b = i;
      out.push((a === b ? "cue " : "cues ") + a + "-" + b + "  " + plan[start].id);
      start = i;
    }
  }
  return out;
}
