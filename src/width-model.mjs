// width-model.mjs -- what a character costs horizontally, and who decides.
//
// WHY THIS IS ITS OWN FILE
// -------------------------
// Two places have to agree exactly on which characters carry width: the
// calibration, which fits coefficients per class, and the runtime fit, which
// sums them to predict a line's width. If they disagree, the coefficients
// describe a different quantity than the one being predicted, and the auto-fit
// is quietly wrong with no error anywhere.
//
// They used to be separate copies of the same ranges, in a .jsx and a .mjs, and
// a test that asserted they matched. Two copies plus a test is one copy and a
// test; this is the one copy.
//
// WHY THE CLASSES ARE NOT SIMPLER
// -------------------------------
// The obvious model is "one number per character". It fails on Devanagari
// because a pre-base matra is reordered by the shaper into space its consonant
// already occupies, so it costs almost nothing -- while a consonant costs a
// full cell. Averaging the two together gives a number that is right for no
// text in particular.
//
// So the characters are split into the four classes that actually behave
// differently, and the calibration fits one coefficient per class from real
// rendered measurements. See scripts/calibrate_width.mjs.

/**
 * The four classes, as explicit code point ranges.
 *
 * Written as \u escapes on purpose. The same ranges written as literal
 * characters were wrong twice: as Devanagari in a regex the boundaries are
 * invisible in a diff, and -- the actual bug this replaced -- "space" was
 * written as U+0020..U+207F, which quietly CONTAINS the whole Devanagari
 * block. Every character then classified as a space, only one column of the
 * design matrix was ever non-zero, and the fit came back singular with an
 * error that pointed at the samples rather than at the classifier.
 *
 * Disjointness matters and is asserted by scripts/check_width_model.mjs.
 * cons includes U+093C (nukta) and matra would otherwise start at U+093A, so
 * an inclusive U+093A..U+094D claims the nukta twice.
 */
const RANGES = {
  // ASCII printable: space, punctuation, Latin letters, ASCII digits. All
  // narrow and near-constant, and none of them occur in these lyrics except
  // the space and the full stop.
  space: [[0x0020, 0x007e]],
  // Consonants, independent vowels, the extra letter blocks, Devanagari
  // digits, and the marks that DO take width: anusvara, candrabindu, nukta.
  cons: [
    [0x0900, 0x0903],
    [0x0904, 0x0939],
    [0x093c, 0x093d],   // nukta, avagraha
    [0x0958, 0x095f],
    [0x0964, 0x096f],   // danda, double danda, digits
    [0x0971, 0x0973],   // ॱ ॲ ॳ
    [0x0978, 0x097f],
  ],
  // Dependent matras and the virama. NOT free: a spacing matra takes room, and
  // assuming these cost nothing is what made the first measurement wrong.
  matra: [
    [0x093a, 0x093b],
    [0x093e, 0x094d],
    [0x0951, 0x0957],
    [0x0962, 0x0963],
  ],
};

/** The virama, which joins the NEXT consonant into a conjunct. */
const VIRAMA = 0x094d;

/** Every class's ranges, for the disjointness test. */
export const CLASS_RANGES = RANGES;

function inRanges(cp, ranges) {
  for (const [lo, hi] of ranges) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

export const CLASSES = ["cons", "matra", "space", "other"];

/** One character -> its class. First match wins, so the order in RANGES is the spec. */
export function classifyChar(ch) {
  const cp = ch.codePointAt(0);
  if (inRanges(cp, RANGES.space)) return "space";
  if (inRanges(cp, RANGES.cons)) return "cons";
  if (inRanges(cp, RANGES.matra)) return "matra";
  return "other";
}

/**
 * A whole line -> a count per class.
 *
 * SEQUENCE-AWARE, unlike classifyChar, because of the conjunct. "क्ष" is
 * three code points -- ka, virama, ssa -- and it draws as ONE glyph, 0.69em
 * wide. Counted per character it is two consonants and a matra, which predicts
 * roughly twice its real width; that single sample was 107% out and dragged
 * every other coefficient with it.
 *
 * So a consonant followed by a virama is counted once, as a conjunct, and both
 * code points are consumed. A virama NOT followed by a consonant -- a
 * half-form, or a stray -- counts as a matra, which is what it costs.
 *
 * Per-character classification cannot do this, which is why both exist:
 * classifyChar answers "what is this character", this answers "what does this
 * line cost". The auto-fit only ever needs the second.
 */
/**
 * A whole line -> a count per class.
 *
 * SEQUENCE-AWARE, because of the conjunct. "क्ष" is three code points -- ka,
 * virama, ssa -- and it draws as ONE glyph, 0.69em wide. Counted per character
 * it is two consonants and a matra, which predicts roughly twice its real
 * width, and that single sample was 107% out and dragged every other
 * coefficient with it.
 *
 * A conjunct is therefore counted as ONE consonant: the pair is consumed and
 * one `cons` is recorded.
 *
 * WHY THERE IS NO SEPARATE CONJUNCT COEFFICIENT
 * ---------------------------------------------
 * There was one, and it fitted to MINUS 0.077em -- a negative width. The two
 * classes are not separable from this data: a conjunct always *replaces* a
 * consonant, so within any sample the count of one moves against the count of
 * the other, and the least-squares solution is free to make one negative to
 * compensate for the other. It predicted its own training samples to 0.0% and
 * would have mispredicted every line with a different consonant-to-conjunct
 * ratio, which is most of them.
 *
 * Counting a conjunct as one consonant costs about 9% on a pure-conjunct line
 * (0.69em measured against 0.63em predicted) and removes the degeneracy
 * entirely. A simpler model that is right beats a richer one that is
 * degenerate, and the whole reason for measuring rather than guessing is to be
 * able to tell the difference.
 *
 * A virama NOT followed by a consonant -- a half-form, or a stray -- counts as
 * a matra, which is what it costs.
 *
 * Per-character classification cannot do any of this, which is why both exist:
 * classifyChar answers "what is this character", this answers "what does this
 * line cost". The auto-fit only ever needs the second.
 */
export function classifyText(text) {
  const out = { cons: 0, matra: 0, space: 0, other: 0 };
  const cps = [...text].map((ch) => ch.codePointAt(0));
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    // A conjunct STARTS at the consonant, not at the virama: ka + virama +
    // ssa is one cell wide, and the cell is the ka's. So the test looks
    // forward FROM the consonant.
    //
    // It used to look forward from the virama instead, which meant the leading
    // consonant was counted on its own and the virama then started a second
    // count -- "क्ष" came out as TWO consonants, exactly the error the conjunct
    // rule exists to prevent, and it passed a calibration because nothing
    // checked it.
    if (
      inRanges(cp, RANGES.cons) &&
      cps[i + 1] === VIRAMA &&
      i + 2 < cps.length &&
      inRanges(cps[i + 2], RANGES.cons)
    ) {
      out.cons++;
      i += 2;            // the virama and the joined consonant are part of it
      continue;
    }
    out[classifyChar(String.fromCodePoint(cp))]++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// CALIBRATION SAMPLES
// ---------------------------------------------------------------------------
//
// These live here rather than in WidthCalib.jsx because the calibrator imports
// them with plain node, and node cannot import a .jsx. They are also the
// definition of what the coefficients MEAN, so the file that classifies
// characters is the right home for the samples that classify characters into
// groups.
//
// The samples span what the four classes do, and between them they are what
// makes the fit identifiable: a model cannot separate "matra" from "other" if
// no sample has a matra and something else.
//
//   "क"      a lone consonant: the unit the model is in
//   "कखगघ"  consonants only, no marks, no spaces
//   "को"     consonant + a post-base matra
//   "कि"     PRE-BASE matra. Shaping reorders it in front of the consonant,
//            which is the case a naive model gets wrong by the most, and the
//            reason this whole file exists
//   "की"     post-base, for contrast with कि
//   "क ख ग"  spaces dominate
//   "नेपाली"  a real word, mixed
//   "क्ष"     a conjunct: THREE code points, one glyph, and the case that
//            first made the fit 107% out
//   "क्षेत्र क्षय"  two conjuncts plus everything else, so the conjunct
//            coefficient is fitted from data rather than left at its default.
//            "क्ष" alone cannot do this job: it is too short to survive the
//            side-bearing filter, so with only that sample the conjunct
//            coefficient was never fitted at all.
//   "१२३४५"  digits, which are narrower than consonants and so are the one
//            sample this model gets visibly wrong. Held in rather than added
//            as a class, because these lyrics contain no digits.
//   a real Allare line, so the fit is anchored to what actually gets rendered
export const SAMPLES = [
  "क",
  "कखगघ",
  "को",
  "कि",
  "की",
  "क ख ग",
  "नेपाली",
  "क्ष",
  "क्षेत्र क्षय",
  "१२३४५",
  "हो.. खोला वारि म कहिले",
];

// Calibration geometry. Big type so the pixel measurement is precise, wide so
// nothing wraps -- a wrapped sample measures two lines and the fit learns that
// a line is half as wide as it is, silently. Tall enough that a 200px
// Devanagari matra, which reaches well outside its line box, cannot be clipped.
export const SAMPLE_PX = 200;
export const SAMPLE_W = 4000;
export const SAMPLE_H = 700;
export const SAMPLE_LEFT = 40;

/**
 * The font stack the overlay actually asks for, in the same order.
 *
 * It has to be here rather than in the calibration, because the calibration has
 * to measure the face that will be used. The overlay asks for Noto Sans
 * Devanagari FIRST, so a calibration that measured Nirmala UI would be fitting
 * coefficients for a font that never appears in the video -- which is the same
 * "confidently wrong number" failure as every other estimate this replaced.
 *
 * The calibration key is the RESOLVED family, not this string, so a font that
 * is not installed cannot quietly fall through to a different one.
 */
export const OVERLAY_FONT_STACK =
  '"Noto Sans Devanagari", "Nirmala UI", "Microsoft New Tai Lue", "Segoe UI", sans-serif';

/**
 * A line's width in em, from the fitted coefficients.
 *
 * `table` is one entry per font in scripts/width.json, e.g.
 *   { cons: 0.63, matra: 0.15, space: 0.42, other: null }
 *
 * A null coefficient means "not fitted" -- the calibration only fits classes its
 * samples exercise, and leaves the rest at the default below. It is not the
 * same as 0: writing 0 for an unexercised class would make every character of
 * that class free, which is how a width model ends up quietly wrong.
 *
 * Falls back to DEFAULTS when no table is supplied, so a render still lays out
 * if the calibration was never run. Those defaults are the old 0.55em constant
 * expressed per class, and the point of this file is that they no longer have
 * to be right.
 */
/**
 * A line's width in em.
 *
 * TWO MODELS, chosen by what the table contains.
 *
 * PER-CLASS (a Unicode font). The text is real Devanagari, so the cost depends
 * on whether a character is a consonant, a matra or a space, and the shaping
 * engine rearranges them. One coefficient each.
 *
 * PER-CHARACTER (a legacy Preeti font). The text is NOT Devanagari by the time
 * it reaches the browser -- lrc_legacy.py has already converted it to the
 * font's ASCII key sequences, and the font maps those keys onto Devanagari
 * glyphs. Every class collapses into one: they are all ASCII. Fitting
 * consonant/matra/space coefficients to ASCII would be fitting three numbers to
 * one, and the classifier would put every character in `space` because that is
 * what an ASCII letter is.
 *
 * So a legacy font gets ONE number: the mean advance per code point, measured
 * from the same rendered samples. It is a cruder model than the per-class one
 * -- it cannot tell a line of many keys from one of few -- but it is measured
 * rather than assumed, which is the whole standard here.
 *
 * `table.perChar` selects the flat model. Its presence is the switch, so a
 * table cannot half-apply.
 *
 * Falls back to DEFAULTS when no table is supplied, so a render still lays out
 * if the calibration was never run. Those defaults are the old 0.55em constant
 * expressed per class, and the point of this file is that they no longer have
 * to be right.
 */
export const DEFAULTS = { cons: 0.62, matra: 0.08, space: 0.26, other: 0.5 };

export function widthEm(text, table) {
  if (table && typeof table.perChar === "number" && Number.isFinite(table.perChar)) {
    return [...text].length * table.perChar;
  }
  const t = { ...DEFAULTS };
  if (table && typeof table === "object") {
    for (const k of CLASSES) {
      if (typeof table[k] === "number" && Number.isFinite(table[k])) t[k] = table[k];
    }
  }
  const c = classifyText(text);
  let w = 0;
  for (const k of CLASSES) w += (c[k] || 0) * t[k];
  return w;
}

/** The single number the old code used, for comparison and for the log. */
export function meanEm(text, table) {
  const n = [...text].length || 1;
  return widthEm(text, table) / n;
}
