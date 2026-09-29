// calibrate_width.mjs -- what a line of this font ACTUALLY measures, in em.
//
// run:  node scripts/calibrate_width.mjs --font "Nirmala UI" [--force]
//
// WHY THIS EXISTS, AND WHY IT IS NOT PYTHON OR A CONSTANT
// --------------------------------------------------------
// The auto-fit has to know how wide a cue will be before it renders, or the
// text is sized for a wrap that does not happen and ends up 25-30% too small.
// Every cheaper way of getting that number has been tried here, and two of them
// were wrong in ways that looked right:
//
//   0.55em constant       fine for Nirmala by luck, and about 2x too wide for
//                         a Preeti font, so every legacy line was shrunk for
//                         nothing
//   mean over the whole   0.7153em for Nirmala. The rendered line measures
//     Devanagari block    0.334em per code point, because a pre-base matra is
//                         reordered into space its consonant already owns
//   mean over consonants 0.7480em. Narrow spaces averaged with wide
//                         consonants under one number
//
// All three guess, and the failure is silent: the text is simply smaller than
// it should be, and a still of a short line looks perfectly fine.
//
// The ground truth is the browser, because the browser is what does the
// shaping. So the samples are rendered by the same engine that will render the
// video, the ink they leave is measured, and the numbers are fitted to that.
// There is no font model here to be wrong about.
//
// WHAT IS FITTED, AND ON WHAT
// ---------------------------
//   width_em = a * consonants + b * matras + c * spaces + d * other
//
// Three fitted classes, because those are the three that behave differently.
// Consonants carry the line; a conjunct counts as ONE consonant, since it
// occupies one cell and a separate coefficient for it fitted to a NEGATIVE
// width -- the two classes are collinear, because a conjunct always replaces a
// consonant, so the fit was free to make one negative to pay for the other.
// Spaces and ASCII punctuation are narrow. "other" catches anything
// unclassified so a stray character cannot silently make a line shorter than it
// draws.
//
// The SAMPLES above are structural: they exist to identify the classes, not to
// pin the numbers. Fitting on them alone gave a model that predicted the real
// Allare line to 0.6% and a plain four-consonant run to 36% -- accurate for the
// one line that mattered and wrong for the shape of most others, because short
// synthetic samples carry a full side bearing and the digit sample is a
// different width class again.
//
// So with --lrc the song's OWN lines are added and the fit runs on those. The
// coefficients then describe the distribution they are used on, and the report
// is a leave-one-out error: each line is predicted by a fit that did not see
// it, which is the only honest way to state how good the model is.
//
// Results are cached in scripts/width.json, keyed by font AND by whether real
// lines were used, so a fit on Allare is not silently reused for another song.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { classifyText, CLASSES, SAMPLES, SAMPLE_PX, DEFAULTS } from "../src/width-model.mjs";

// The old 0.55em constant, used only as a last resort if a legacy fit comes
// out degenerate. See width-model.mjs for why it was wrong.
const DEFAULTS_PER_CHAR = 0.55;
import { parseLrc } from "../src/parse-lrc.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const CACHE = path.join(HERE, "width.json");

function flag(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

function pythonWith(mod) {
  for (const c of ["py", "python", "python3"]) {
    try {
      execFileSync(c, ["-c", "import " + mod + "; pass"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return c;
    } catch {
      // try the next
    }
  }
  return null;
}

// ---- least squares, by hand ----------------------------------------------
//
// A 4x4 solved by Gaussian elimination with partial pivoting, rather than a
// dependency. The whole point of this repo is that a render needs nothing
// installed, and a calibration step that needs `npm install` to run is a
// calibration step that does not get run.
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    const t = M[col];
    M[col] = M[piv];
    M[piv] = t;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => (M[i][i] === 0 ? 0 : row[n] / M[i][i]));
}

/**
 * Least squares with the coefficients held at ZERO OR MORE.
 *
 * A width cannot be negative, and an unconstrained solve will happily produce
 * one: it happened twice here, for `conj` (-0.077em) and for `matra`
 * (-0.108em), both because the class is collinear with `cons` -- matra-heavy
 * lines also tend to be consonant-heavy, so the fit makes one negative to pay
 * for the other. Such a fit can be accurate on the data it was given and
 * nonsense one line away, which is the worst of both.
 *
 * So the solve is greedy: fit everything, and any coefficient that comes out
 * negative is pinned to zero and the rest are re-fitted without it. Repeat
 * until nothing is negative. That is not true non-negative least squares --
 * the order of elimination can matter -- but it is monotone in practice here
 * and it cannot produce a physically impossible number.
 */
function solveNonNegative(observations, classes) {
  let active = classes.slice();
  const values = {};
  for (let pass = 0; pass < classes.length + 1; pass++) {
    const k = active.length;
    if (!k) break;
    const AtA = Array.from({ length: k }, () => new Array(k).fill(0));
    const Aty = new Array(k).fill(0);
    for (const o of observations) {
      for (let r = 0; r < k; r++) {
        for (let c = 0; c < k; c++) AtA[r][c] += o.counts[active[r]] * o.counts[active[c]];
        Aty[r] += o.counts[active[r]] * o.widthEm;
      }
    }
    const coefs = solve(AtA, Aty);
    if (!coefs) return null;
    let worstAt = -1;
    for (let i = 0; i < k; i++) {
      if (coefs[i] < 0 && (worstAt < 0 || coefs[i] < coefs[worstAt])) worstAt = i;
    }
    if (worstAt < 0) {
      for (let i = 0; i < k; i++) values[active[i]] = coefs[i];
      return { values, active };
    }
    // Pin it to zero and try again without that column.
    values[active[worstAt]] = 0;
    active = active.filter((_, i) => i !== worstAt);
  }
  return { values, active };
}

/**
 * Fit only the classes the samples actually exercise.
 *
 * A class with an all-zero column makes the normal equations singular -- there
 * is no information about its coefficient -- and the solve comes back null with
 * a message about the samples when the real problem is that one class was never
 * tested. "other" is exactly that: nothing in the ten samples lands in it, so
 * its coefficient is whatever src/width-model.mjs defaults it to.
 */
function activeClasses(observations) {
  return CLASSES.filter((k) => observations.some((o) => (o.counts[k] || 0) > 0));
}

/**
 * Which samples may be FITTED, as opposed to merely reported.
 *
 * A one- or two-character sample measures wider per character than the same
 * characters in a run, because a lone glyph carries its full left side bearing
 * while interior bearings are shared. Measured: "क" alone is 0.905em, but the
 * same ka in "कखगघ" averages 0.754em. Fitting on the short samples therefore
 * biases every coefficient upward, which makes the auto-fit over-predict width
 * and shrink the delivered text -- the exact failure this whole exercise
 * exists to remove, reintroduced through the calibration.
 *
 * So samples with fewer than MIN_FIT_CHARS width-carrying characters are held
 * out of the fit and still printed, as a check that the model is not doing
 * anything absurd at the short end. They are also not what the fit is FOR: the
 * model only ever predicts whole cue lines, and Allare's median line is 22
 * code points.
 */
const MIN_FIT_CHARS = 4;

function fittable(o) {
  const n = CLASSES.reduce((s, k) => s + (o.counts[k] || 0), 0);
  return n >= MIN_FIT_CHARS;
}

function fitCoefficients(observations, active) {
  const solved = solveNonNegative(observations, active);
  if (!solved) return null;
  const { values, active: kept } = solved;
  const coefs = active.map((k) => (k in values ? values[k] : 0));

  const predict = (o) => active.reduce((s, cls, i) => s + o.counts[cls] * coefs[i], 0);
  let worst = 0;
  let worstSample = "";
  for (const o of observations) {
    const err = Math.abs(predict(o) - o.widthEm) / Math.max(o.widthEm, 1e-6);
    if (err > worst) {
      worst = err;
      worstSample = o.text;
    }
  }
  return { coefs, active, kept, worstError: worst, worstSample, predict };
}

// The sample list is written to a GENERATED module rather than passed as a
// prop, for the same reason src/lyrics.generated.js exists: a Devanagari string
// in inputProps came back empty, and an empty frame measures as zero width
// rather than as an error. An index cannot be mangled, but an index into a list
// the composition does not have is just as silent -- SAMPLES[11] on an
// 11-element array is undefined, it renders nothing, and the calibration would
// fit a coefficient to zero.
const GENERATED = path.join(ROOT, "src", "calib-samples.generated.js");

function writeGeneratedSamples(list, model, font) {
  writeFileSync(
    GENERATED,
    "// GENERATED by scripts/calibrate_width.mjs -- do not edit.\n" +
      "// The calibration sample list for the font most recently measured.\n" +
      'export const CALIB_MODEL = ' + JSON.stringify(model) + ";\n" +
      'export const CALIB_FONT = ' + JSON.stringify(font || "") + ";\n" +
      "export const CALIB_SAMPLES = " + JSON.stringify(list, null, 2) + ";\n",
    "utf8"
  );
}

/**
 * Convert the samples to a legacy font's key sequences.
 *
 * A Preeti-era font is handed ASCII, not Devanagari: lrc_legacy.py converts
 * first and the font maps keys onto glyphs. The calibration has to render the
 * SAME text the video will render, or it measures a font that never sees these
 * glyphs -- and the whole point of measuring the browser is that the browser is
 * the thing doing the drawing.
 *
 * The conversion is done by the renderer's own script with the same layout
 * file, rather than reimplemented here, so the two cannot disagree about what
 * "Preeti key sequence" means.
 */
function toKeys(lines, layoutFile) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "calib-keys-"));
  const src = path.join(dir, "in.lrc");
  const dst = path.join(dir, "out.lrc");
  // The samples are written as TIMESTAMPED lines because that is all
  // lrc_legacy.py converts: its row pattern is anchored on `[m:ss.xx]`, so plain
  // text comes back as "0 lines encoded" with no error. The stamps are stripped
  // again below -- they are a formality to get past the parser, not part of
  // what is measured.
  writeFileSync(
    src,
    lines.map((s, i) => "[00:" + String(i).padStart(2, "0") + ".00]" + s).join("\n"),
    "utf8"
  );
  let converted = null;
  try {
    execFileSync(
      pythonWith("npttf2utf") || "py",
      [path.join(HERE, "lrc_legacy.py"), src, dst, "--layout-file", layoutFile],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
    );
    // Read INSIDE the try. The finally below removes the directory, so reading
    // after it is an ENOENT on a file that demonstrably existed a moment ago.
    converted = readFileSync(dst, "utf8")
      .split(/\r?\n/)
      // Drop the metadata the converter adds, and the stamps.
      .filter((s) => s && !/^\[[a-z-]+:/i.test(s))
      .map((s) => s.replace(/^(\[\d{1,3}:[0-5]?\d(?:[.:]\d{1,3})?\])+/, ""))
      .filter((s) => s.length);
  } catch (err) {
    throw new Error(
      "could not convert the samples to key sequences: " +
        (err && err.stderr ? String(err.stderr).trim() : err.message) +
        "\nNeeds python + npttf2utf, and a --layout-file for this font."
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (!converted.length) {
    throw new Error(
      "lrc_legacy.py produced no lines. The --layout-file is probably for a\n" +
        "             different font: a Preeti layout on an AMS font maps keys the\n" +
        "             font has no glyphs for, and the converter silently drops them."
    );
  }
  return converted;
}

async function renderAndMeasure(all, font, serveUrl) {
  const outDir = path.join(ROOT, "out", "calib");
  mkdirSync(outDir, { recursive: true });
  const { renderStill, selectComposition } = await import("@remotion/renderer");
  const py = pythonWith("PIL");
  if (!py) throw new Error("calibration needs Pillow: pip install pillow");

  // The sample travels as an INDEX, never as text -- see writeGeneratedSamples.
  const widths = [];
  for (let i = 0; i < all.length; i++) {
    const inputProps = { font, index: i };
    const composition = await selectComposition({ serveUrl, id: "WidthCalib", inputProps });
    const png = path.join(outDir, String(i) + ".png");
    await renderStill({
      composition,
      serveUrl,
      output: png,
      frame: 0,
      imageFormat: "png",
      overwrite: true,
    });
    const raw = execFileSync(py, [path.join(HERE, "measure_ink.py"), png], {
      encoding: "utf8",
      windowsHide: true,
    });
    widths.push(parseFloat(raw.trim()));
  }
  return widths;
}

/**
 * Put the font where the composition can find it, exactly as a render would.
 *
 * The calibration renders the WidthCalib composition, which registers the font
 * from src/lyrics.generated.js -- the same module LyricOverlay reads. So the
 * font has to be COPIED INTO public/fonts and that module REWRITTEN before the
 * bundle is built, and the only thing that does both correctly is render.mjs
 * itself. So it is called, with --prepare-only and the real song, rather than
 * reimplementing two steps that must agree with a third consumer.
 *
 * When this was skipped, the stack fell through to Nirmala UI and the fit came
 * out bit-identical to the Nirmala one -- cons 0.6287, matra 0, space 0.4470 for
 * both. Fifteen candidate faces were compared and every one of them was the
 * system font. A calibration that cannot tell you it measured the wrong thing is
 * worse than no calibration, so the font is verified afterwards rather than
 * assumed: a fit whose coefficients are identical to another font's is a bug,
 * and the report says so.
 */
function prepareFont({ font, lrc, audio, fontFile, layout }) {
  if (!lrc || !audio) {
    throw new Error(
      "the calibration needs --lrc and --audio so it can prepare the font the way a\n" +
        "  render does. Without them the composition falls back to the system font\n" +
        "  and the fit describes a typeface that will never be used."
    );
  }
  const args = [
    path.join(ROOT, "render.mjs"), audio, lrc,
    "--no-audio", "--length", "30", "--prepare-only",
  ];
  if (fontFile) args.push("--font-file", fontFile);
  if (layout) args.push("--legacy-font", fontFile, "--layout-file", layout, "--font", font);
  execFileSync(process.execPath, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

/** Read back what the generated module now says, to confirm the face is right. */
function preparedFontName() {
  const p = path.join(ROOT, "src", "lyrics.generated.js");
  if (!existsSync(p)) return null;
  const src = readFileSync(p, "utf8");
  const f = /export const FONT_FAMILY_NAME = (".*?");/.exec(src);
  const l = /export const LEGACY_FONT_FAMILY = (".*?");/.exec(src);
  try {
    const a = f ? JSON.parse(f[1]) : "";
    const b = l ? JSON.parse(l[1]) : "";
    return b || a || null;
  } catch {
    return null;
  }
}

/**
 * The song's own lines, spread across the file rather than taken from the top.
 *
 * Taken from the top they would all be the first verse, which is the most
 * regular part of any song; the long chorus lines that are the ones most likely
 * to overflow the band would never be measured. Every nth line, deterministically,
 * so two runs on the same song pick the same lines and the cache stays valid.
 */
const MAX_REAL_SAMPLES = 12;

function realLines(lrcPath) {
  if (!lrcPath || !existsSync(lrcPath)) return [];
  let cues = [];
  try {
    cues = parseLrc(readFileSync(lrcPath, "utf8")).cues;
  } catch {
    return [];
  }
  const texts = [...new Set(cues.map((c) => String(c.text || "").trim()))].filter(Boolean);
  if (texts.length <= MAX_REAL_SAMPLES) return texts;
  const step = texts.length / MAX_REAL_SAMPLES;
  const out = [];
  for (let i = 0; i < MAX_REAL_SAMPLES; i++) {
    out.push(texts[Math.min(texts.length - 1, Math.floor(i * step))]);
  }
  return out;
}

async function main() {
  const font = flag("--font", "Nirmala UI");
  const force = process.argv.includes("--force");
  const lrc = flag("--lrc", "");
  const layout = flag("--preeti", "");
  const fontFile = flag("--font-file", "");
  const audio = flag("--audio", "");
  let extras = realLines(lrc);

  // A legacy font is measured on the key sequences it will actually be handed.
  // The per-class model does not apply to them: they are all ASCII, so every
  // character would classify as `space` and the fit would be one number trying
  // to be three. So this is a single-coefficient, per-code-point fit.
  const preeti = !!layout;
  if (preeti) {
    const { SAMPLES: struct, ...rest } = { SAMPLES, ...{} };
    extras = toKeys([...SAMPLES, ...extras], layout);
  }

  let cache = {};
  if (existsSync(CACHE)) {
    try {
      cache = JSON.parse(readFileSync(CACHE, "utf8"));
    } catch {
      cache = {};
    }
  }
  // Keyed by whether real lines were used: a fit on Allare's own text must not
  // be handed to the next song as though it were general.
  const key = font + (extras.length && !preeti ? " +song" : "");
  const have = cache[key];
  if (have && !force) {
    const c = have.perChar != null
      ? "perChar " + have.perChar
      : CLASSES.map((k) => k + " " + have[k]).join("  ");
    console.log("  " + key + ": cached  " + c + " em  (worst " + (have.worstError * 100).toFixed(1) + "%)");
    return;
  }

  console.log(
    "  calibrating " + key + " at " + SAMPLE_PX + "px against the browser" +
      (extras.length ? ", including " + extras.length + " lines from the song" : "") +
      "..."
  );
  // Prepare the font FIRST, and confirm the composition will actually use it.
  prepareFont({ font, lrc, audio, fontFile, layout });
  const prepared = preparedFontName();
  if (prepared && prepared !== font) {
    console.warn(
      "  note: asked to calibrate " + JSON.stringify(font) + " but the composition will\\n" +
        "        use " + JSON.stringify(prepared) + ". The fit would describe the wrong\\n" +
        "        face. Pass --font-file <the ttf>, or --font if it is installed."
    );
    process.exitCode = 1;
    return;
  }

  // The generated sample list has to exist BEFORE the bundle is built. The
  // bundle inlines it, so writing it afterwards leaves the composition holding
  // the previous run's list -- which is how the first attempt rendered index 11
  // as an empty frame and measured it as zero width, with no error anywhere.
  const all = preeti ? extras : [...SAMPLES, ...extras];
  writeGeneratedSamples(all, preeti ? "preeti" : "unicode", font);

  // One bundle for the whole set: renderStill is then just a headless
  // screenshot, and re-bundling per sample would dominate the runtime.
  const { bundle } = await import("@remotion/bundler");
  const serveUrl = await bundle({
    entryPoint: path.join(ROOT, "src", "index.js"),
    onProgress: () => {},
  });
  const widths = await renderAndMeasure(all, font, serveUrl);

  const observations = all.map((text, i) => ({
    text,
    real: i >= SAMPLES.length,
    counts: classifyText(text),
    widthEm: widths[i] / SAMPLE_PX,
    measured: widths[i],
  }));

  if (preeti) {
    // ONE coefficient: the mean advance per code point. Least squares on a
    // single parameter with no intercept is just sum(n*w) / sum(n*n), and it
    // is done in closed form rather than through the general solver so there is
    // no matrix to go singular.
    let num = 0;
    let den = 0;
    for (const o of observations) {
      const n = Math.max(1, [...o.text].length);
      num += n * o.widthEm;
      den += n * n;
    }
    const perChar = den > 0 ? num / den : DEFAULTS_PER_CHAR;
    let worst = 0;
    let worstText = "";
    for (const o of observations) {
      const pred = perChar * Math.max(1, [...o.text].length);
      const err = Math.abs(pred - o.widthEm) / Math.max(o.widthEm, 1e-6);
      if (err > worst) {
        worst = err;
        worstText = o.text;
      }
    }
    console.log("  legacy key sequences: per code point " + perChar.toFixed(4) + " em");
    console.log("    worst sample: " + (worst * 100).toFixed(1) + "% on " + JSON.stringify(worstText));
    for (const o of observations) {
      const pred = perChar * Math.max(1, [...o.text].length) * SAMPLE_PX;
      console.log(
        "      " + (o.real ? "r" : "s") + " " + JSON.stringify(o.text).padEnd(30) +
          "measured " + o.measured.toFixed(1).padStart(7) + "px   predicted " +
          pred.toFixed(1).padStart(7) + "px   " +
          (((pred - o.measured) / o.measured) * 100).toFixed(1).padStart(7) + "%"
      );
    }
    if (worst > 0.12) {
      console.warn(
        "    warning: " + (worst * 100).toFixed(1) +
          "% worst error. A single per-code-point number cannot describe a key\n" +
          "             font well -- some keys are one glyph and some are two --\n" +
          "             so the auto-fit will be approximate for this font."
      );
    }
    const entry = {
      perChar: Number(perChar.toFixed(5)),
      model: "per-char",
      pixelSize: SAMPLE_PX,
      worstError: worst,
      calibratedOn: layout,
      calibratedAt: new Date().toISOString().slice(0, 10),
    };
    cache[key] = entry;
    writeFileSync(CACHE, JSON.stringify(cache, null, 2) + "\n", "utf8");
    console.log("    wrote " + path.relative(ROOT, CACHE) + "  [" + key + "]");
    return;
  }

  // Fit on the real lines when there are enough of them, because they are the
  // distribution the model is used on. The structural samples are still held in
  // the report as a check that nothing has gone badly wrong at the short end.
  const realObs = observations.filter((o) => o.real);
  const fitSet = realObs.length >= 4 ? realObs : observations.filter(fittable);
  const held = observations.filter((o) => !fitSet.includes(o));

  const active = activeClasses(fitSet);
  if (active.length < 2) {
    throw new Error(
      "only " + active.length + " class is exercised by the fittable samples (" +
        active.join(", ") + "), so the coefficients cannot be separated"
    );
  }
  const fitted = fitCoefficients(fitSet, active);
  if (!fitted) throw new Error("the fit is singular; the samples do not span the problem");

  const { coefs, worstError, worstSample, predict } = fitted;
  console.log(
    "    fitted on: " + active.join(", ") +
      (active.length < CLASSES.length
        ? "   (not fitted: " + CLASSES.filter((c) => !active.includes(c)).join(", ") + ")"
        : "")
  );
  console.log(
    "    " + active.map((k, i) => k + " " + coefs[i].toFixed(4) + "em").join("   ")
  );
  console.log(
    "    fitted on " + fitSet.length + (realObs.length >= 4 ? " real line(s)" : " structural sample(s)") +
      ", held out " + held.length
  );

  // LEAVE-ONE-OUT, reported two ways, because the two answer different
  // questions and only one of them matters.
  //
  //   long lines   the ones that actually WRAP. This is the metric that
  //                decides whether the auto-fit gets a wrap right, and on
  //                Allare it comes out at 1-6%.
  //   short lines  predicted badly -- "सधैँ.." is 43% out -- because a short
  //                line carries a full side bearing on each side while a
  //                long one amortises it. It does not matter, and saying so is
  //                more useful than hiding it: a short line never wraps, so
  //                fit() returns fontSize for it whatever the model says, and
  //                the error cannot reach the delivered file.
  //
  // Reporting only the overall figure would have said 52% and implied the model
  // was unusable, when every line it is actually consulted for is within 6%.
  const BAND_EM = (64 * 19.2) / 128;   // a 64vw band at the default 128px
  const wraps = (o) => o.widthEm > BAND_EM;
  let looWorstLong = 0, looWorstLongText = "";
  let looWorstShort = 0, looWorstShortText = "";
  let wrapFlips = 0;
  if (realObs.length >= 4) {
    for (let i = 0; i < realObs.length; i++) {
      const rest = realObs.filter((_, j) => j !== i);
      const f = fitCoefficients(rest, activeClasses(rest));
      if (!f) continue;
      const pred = f.predict(realObs[i]);
      const err = Math.abs(pred - realObs[i].widthEm) / realObs[i].widthEm;
      // Did the model agree with the browser about whether this line wraps at
      // all? A disagreement is the failure that clips text, whatever the
      // percentage error.
      if (wraps({ widthEm: pred }) !== wraps(realObs[i])) wrapFlips++;
      if (wraps(realObs[i])) {
        if (err > looWorstLong) { looWorstLong = err; looWorstLongText = realObs[i].text; }
      } else if (err > looWorstShort) { looWorstShort = err; looWorstShortText = realObs[i].text; }
    }
    console.log(
      "    leave-one-out, lines that WRAP: " + (looWorstLong * 100).toFixed(1) +
        "% worst on " + JSON.stringify(looWorstLongText)
    );
    console.log(
      "    leave-one-out, lines that fit : " + (looWorstShort * 100).toFixed(1) +
        "% worst on " + JSON.stringify(looWorstShortText) + "  (never wraps; no effect)"
    );
    console.log(
      "    wrap/no-wrap disagreements    : " + wrapFlips + " of " + realObs.length
    );
  }

  for (const o of observations) {
    const px = predict(o) * SAMPLE_PX;
    console.log(
      "      " + (o.real ? "r" : "s") + " " + JSON.stringify(o.text).padEnd(30) +
        "measured " + o.measured.toFixed(1).padStart(7) + "px   predicted " +
        px.toFixed(1).padStart(7) + "px   " +
        (((px - o.measured) / o.measured) * 100).toFixed(1).padStart(7) + "%"
    );
  }
  console.log("    (r = a line from the song, s = a structural sample held out of the fit)");

  // The metric that decides whether this is usable: the leave-one-out error on
  // lines that wrap, and whether the model ever disagreed with the browser about
  // whether a line wraps. A disagreement is what clips text.
  const headline = realObs.length >= 4 ? looWorstLong : worstError;
  if (wrapFlips > 0) {
    console.error(
      "    FAIL the model disagreed with the browser about whether " + wrapFlips +
        " line(s) wrap.\n" +
        "           That is the failure that clips text off the bottom of the\n" +
        "           frame, so this calibration is not safe to use."
    );
    process.exitCode = 1;
  } else if (realObs.length >= 4) {
    console.log(
      "    good: every line agreed with the browser about wrapping, and the\n" +
        "          wrapping ones are within " + (headline * 100).toFixed(1) + "%."
    );
  }
  if (headline > 0.12) {
    console.warn(
      "    warning: " + (headline * 100).toFixed(1) +
        "% leave-one-out error on the lines that wrap. The auto-fit will be\n" +
        "             approximate; render a still before delivering."
    );
  }

  const entry = { fitted: active };
  CLASSES.forEach((k, i) => {
    const at = active.indexOf(k);
    // A class the samples never exercised keeps the default, and says so here
    // rather than being written as a fitted 0, which would make every
    // unclassified character free.
    entry[k] = at >= 0 ? Number(coefs[at].toFixed(5)) : null;
  });
  entry.pixelSize = SAMPLE_PX;
  entry.worstError = headline;
  entry.inSampleWorstError = worstError;
  entry.calibratedOn = lrc ? path.basename(lrc) : "structural samples only";
  entry.calibratedAt = new Date().toISOString().slice(0, 10);
  cache[key] = entry;
  writeFileSync(CACHE, JSON.stringify(cache, null, 2) + "\n", "utf8");
  console.log("    wrote " + path.relative(ROOT, CACHE) + "  [" + key + "]");
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exitCode = 1;
});
