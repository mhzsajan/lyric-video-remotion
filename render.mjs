#!/usr/bin/env node
/*
 * render.mjs -- one command from "song.mp3 + lyrics.lrc" to a transparent
 * lyric overlay you can drop onto a Videosync2 layer.
 *
 *   node render.mjs <audio> <lyrics.lrc> [options]
 *
 * Options
 *   --out <file>        output path (default: out/<song>.mp4)
 *   --preview           fast, small, no alpha -- for checking timing only
 *   --no-audio          text-only overlay: no audio track in the output
 *   --font <family>     font family to render with (must be installed)
 *   --style <name>      pin every line to one animation instead of mixing
 *   --position <pos>    top | center | bottom        (default center)
 *   --size <px>         font size                    (default 104)
 *   --color <#hex>      text colour                  (default #ffffff)
 *   --seed <text>       animation seed (default: song title from the .lrc)
 *   --report-only       print the cue list and exit -- no render
 *   --batch <dir>       render every audio+lrc pair in <dir>
 *
 * Why --preview exists: ProRes 4444 at 1080p60 is roughly 1.5 GB for a
 * four-minute song and takes minutes to encode. Preview renders in seconds at
 * quarter size so you can confirm the timings before committing to a long one.
 *
 * Console output is deliberately ASCII-only: a Windows console will otherwise
 * render box-drawing characters as mojibake.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GENERATED = path.join(HERE, "src", "lyrics.generated.js");
const PUBLIC = path.join(HERE, "public");

const STYLES = [
  "fade", "rise", "pop", "slide-left", "slide-right",
  "typewriter", "blur-in", "zoom-through", "glow",
];

// -- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => {
  // Support BOTH "--name value" and "--name=value": only parsing the space
  // form made "--fps=60" silently return null and fall back to the default
  // (found via --debug-args: props said fps:30 while the user asked for 60).
  const i = argv.indexOf(name);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(name + "="));
  return eq ? eq.slice(name.length + 1) : null;
};
const has = (name) => argv.includes(name);

const positional = argv.filter((a, i) => {
  if (a.startsWith("--")) return false;
  const prev = argv[i - 1];
  return !(prev && prev.startsWith("--") && prev !== "--batch");
});

const PREVIEW = has("--preview");
const NO_AUDIO = has("--no-audio");
const REPORT_ONLY = has("--report-only");
const PREPARE_ONLY = has("--prepare-only");

// mp4 (default): H.264, white text on BLACK background -- no alpha possible
//   in mp4, so the consumer keys it with Add/Screen blend (Videosync2: set
//   the layer blend to Add). Tiny files, plays everywhere.
// mov: ProRes 4444 true alpha for layer hosts that read the alpha channel.
const FORMAT = (flag("--format") || "mp4").toLowerCase();
if (!["mp4", "mov"].includes(FORMAT)) {
  console.error('  Unknown --format "' + FORMAT + '". Use mp4 or mov.');
  process.exit(1);
}

// --legacy-font ams.manthan.ttf: render through a Preeti-era font by
// converting the Unicode lyrics to that font's key sequences first. Needs
// python + npttf2utf (see scripts/lrc_legacy.py). Pair with --font <family>.
const LEGACY_FONT = flag("--legacy-font");
const FONT_FILE_ARG = flag("--font-file");
const BATCH = flag("--batch");

// These are opposite operations, so asking for both is a mistake worth naming
// rather than a precedence question. Checked at the top of run(), before
// either font is resolved: the legacy path fails first on a bad file and would
// otherwise report "font not found" for a request that was never going to work.
function refuseBothFonts() {
  console.error(
    "  --font-file and --legacy-font are two different things and cannot be\n" +
      "  combined. --font-file uses the font as-is; --legacy-font converts the\n" +
      "  lyrics to that font's key sequences first. A Unicode face needs no\n" +
      "  layout and has no risk of wrong letters, which is usually the one you\n" +
      "  want: see the Font section of the README."
  );
  process.exitCode = 1;
}

// Which key layout the legacy font speaks. npttf2utf knows five; a font
// outside those needs a map generated from the publisher's character table
// (scripts/anepali_charmap.py) and passed here with --layout-file. Preeti is
// NOT a safe default for an arbitrary Nepali font: feeding Preeti keys to
// AMS Manthan renders collapsed glyphs and literal `==` instead of the danda.
const LEGACY_LAYOUT = flag("--layout") || "Preeti";
const LEGACY_LAYOUT_FILE = flag("--layout-file") || null;

// HOW LONG THE VIDEO IS
// --------------------
// calculateMetadata sets the length to max(audio length, last cue end). When
// the audio is muxed in, that probe is exact and nothing is needed.
//
// With --no-audio there is no audio in the composition to probe, so the
// length collapses to "where the last lyric ends". The .lrc records only when
// a line BEGINS, so that end is an ESTIMATE from the next line, and a song
// whose final lyric is a minute before the last note gets a video a minute
// short. Measured: Kali Kali is 6:49.1 of audio, its last lyric ends at
// 5:47.5, and the render was 5:49.5 -- the overlay stopped while the song
// was still playing.
//
// --length fixes it, and --no-audio without it now says so rather than
// quietly producing a short file.
const LENGTH = Number(flag("--length"));
const explicitSeconds = Number.isFinite(LENGTH) && LENGTH > 0 ? LENGTH : 0;

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const rule = (label) => console.log("\n-- " + label + " " + "-".repeat(Math.max(0, 52 - label.length)));

// -- helpers ---------------------------------------------------------------
function legacyFamilyGuess(file) {
  // AMS TTFs are named ams.<name>.ttf; family names are Title Case per word.
  const base = path.basename(file).replace(/\.(ttf|otf)$/i, "");
  const m = base.match(/^ams[._](.+)$/i);
  const raw = m ? m[1] : base;
  const parts = raw
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w) => (w.length > 1 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()));
  const name = parts.join(" ");
  // ams.manthan.ttf -> "AMS Manthan" (the family inside the font's name
  // table; the CSS name must match it exactly or Chromium falls back again).
  return /^ams$/i.test(m ? m[1].split(/[\s._-]+/)[0] : "")
    ? name
    : "AMS " + name;
}

// Find a working Python interpreter, or null if there is none.
//
// The transcoder (scripts/lrc_legacy.py) is Python and is not optional for
// --legacy-font. Probing for the interpreter up front turns a confusing ENOENT
// thrown from deep inside execFileSync into a plain sentence about Python.
//
// `py` is checked too: on Windows a common install has the launcher but no
// `python` shim on PATH, and this is the single most likely reason a correct
// machine still fails here.
function pythonCommand() {
  const candidates =
    process.platform === "win32"
      ? [["python", ["-c", "pass"]], ["py", ["-c", "pass"]], ["python3", ["-c", "pass"]]]
      : [["python3", ["-c", "pass"]], ["python", ["-c", "pass"]]];
  for (const [cmd, args] of candidates) {
    try {
      execFileSync(cmd, args, { stdio: "ignore", windowsHide: true });
      return { cmd };
    } catch {
      // not this one; try the next
    }
  }
  return null;
}
/**
 * The width table for the font this render will use.
 *
 * WHAT THIS IS
 * ------------
 * The auto-fit has to know how wide a cue will be before it renders, or the
 * text is sized for a wrap that does not happen and the delivered video is
 * quietly 25-30% smaller than it needs to be. Three cheaper answers were tried
 * first and all three were wrong in ways that looked right:
 *
 *   0.55em per code point     a Preeti font is ~0.48em per code point, so every
 *                             legacy line was predicted to wrap when it does
 *                             not, and got shrunk for nothing
 *   mean of the font's        0.7153em for Nirmala UI. A pre-base matra is
 *     hmtx advances           reordered by the shaper into space its consonant
 *     (fontTools)             already owns, so the real cost is ~0.33em per
 *                             code point. This predicted three lines for a line
 *                             the browser draws on one
 *   mean over consonants      0.7480em, still averaging narrow spaces in with
 *     only                    wide consonants
 *
 * So the numbers are MEASURED, by rendering sample lines in the same browser
 * that will render the video and measuring the ink they leave. See
 * scripts/calibrate_width.mjs. The result is cached in scripts/width.json,
 * keyed by font and by whether a song's own lines were used in the fit.
 *
 * WHY THE SONG MATTERS
 * --------------------
 * A fit on synthetic micro-samples described the real Allare line to 0.6% and a
 * plain four-consonant run to 36% -- right for the one line that mattered and
 * wrong for the shape of most others, because short samples carry a full side
 * bearing. So `scripts/calibrate_width.mjs --lrc <song>` adds twelve of the
 * song's own lines and fits on those, and reports leave-one-out error. On
 * Allare that is 2.4% on the lines that wrap, with the browser agreeing about
 * whether every line wraps.
 *
 * Returns null when there is no table, and the component then falls back to its
 * per-class defaults. Said out loud rather than silently, because a silent
 * fallback is how the original 0.55 shipped.
 */
function widthTableFor(fontFamily, lrcPath) {
  const cachePath = path.join(HERE, "scripts", "width.json");
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch {
    return { table: null, note: "scripts/width.json is missing" };
  }
  // The overlay's CSS stack, in the order it is asked. Whichever of these is
  // installed FIRST is the face that will actually be drawn, so that is the one
  // the calibration has to be for. With no --font and no --font-file the stack
  // starts at "Noto Sans Devanagari", and looking that up first rather than
  // defaulting straight to Nirmala is the difference between measuring the right
  // face and confidently measuring the wrong one.
  //
  // A named family is used ALONE, never as a hint to search the stack. A
  // --font-file face is registered under its own name and is the one that will
  // be drawn, so falling back to "Nirmala UI +song" -- which existed in the
  // cache -- would measure a different font and fit the wrong widths for it.
  // A wrong-but-close number is the failure mode this whole table exists to
  // remove, so a miss is reported rather than papered over.
  const stack = fontFamily
    ? [fontFamily]
    : ["Noto Sans Devanagari", "Nirmala UI", "Microsoft New Tai Lue", "Segoe UI"];

  const candidates = [];
  for (const fam of stack) {
    // A fit on this song's own lines is preferred over a per-font one: it
    // describes the distribution the model is actually used on.
    candidates.push(fam + " +song", fam);
  }
  for (const k of candidates) {
    if (cache[k]) {
      return {
        table: cache[k],
        key: k,
        song: k.endsWith(" +song"),
        family: k.replace(" +song", ""),
      };
    }
  }
  const anyKey = Object.keys(cache)[0];
  if (anyKey) {
    return {
      table: null,
      note:
        "no entry for " + stack.join(" / ") + "; the closest is " + anyKey +
        ". Run: node scripts/calibrate_width.mjs --font \"" + stack[0] +
        "\" --lrc <song.lrc>",
    };
  }
  return {
    table: null,
    note:
      "scripts/width.json is empty. Run: node scripts/calibrate_width.mjs " +
      "--font \"" + stack[0] + "\" --lrc <song.lrc>",
  };
}
function resolveLegacyFont(fileOrPath, lrcPath) {
  // Accept an absolute path, a path relative to the song folder (where the
  // 01 Fonts collection lives one level up), or a bare file name there.
  const candidates = [
    fileOrPath,
    path.join(path.dirname(lrcPath), fileOrPath),
    path.join(path.dirname(lrcPath), "..", "01 Fonts", fileOrPath),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.resolve(c);
  }
  console.error("  Legacy font not found: " + fileOrPath);
  console.error("  Looked in: " + candidates.join("\n             "));
  process.exit(1);
}
/**
 * @param seconds explicit duration. See AUDIO_SECONDS below for why a
 *   --no-audio render has to carry one.
 */
/**
 * Read a .ttf's family name, so --font-file does not have to be told.
 *
 * The name is taken from the font rather than from --font because the two
 * disagree more often than not -- "Yantramanav" in the file, "Yantra Manav" in
 * a README, "Halant" in one place and "Halant New" in another -- and a mismatch
 * does not error. The CSS family simply does not resolve, the browser falls
 * through to the system font, and the render looks like the flag was ignored.
 */
function readFontFamily(file) {
  const py = pythonCommand();
  if (!py) return null;
  const script = path.join(HERE, "scripts", "font_family.py");
  if (!fs.existsSync(script)) return null;
  try {
    const out = execFileSync(py.cmd, [script, file], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const name = String(out).trim();
    return name && name.length < 80 ? name : null;
  } catch {
    return null;
  }
}

function writeGenerated(lrcText, audioFile, legacy = null, seconds = 0, fontFile = null, fontFamilyName = null) {
  const esc = (s) =>
    s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  const body =
    "// GENERATED by render.mjs -- do not edit.\n\n" +
    "export const LRC_TEXT = `" + esc(lrcText) + "`;\n\n" +
    "export const AUDIO_FILE = " + JSON.stringify(audioFile || "") + ";\n\n" +
    "// Non-empty when rendering with a legacy Preeti-era font: the family to\n" +
    "// register via FontFace and the .ttf file name inside public/fonts/.\n" +
    "export const LEGACY_FONT_FILE = " + JSON.stringify(legacy ? legacy.file : "") + ";\n" +
    "export const LEGACY_FONT_FAMILY = " + JSON.stringify(legacy ? legacy.family : "") + ";\n" +
    "\n// Non-empty for --font-file: a local .ttf registered under a name of our\n" +
    "// choosing, with the lyrics UNCHANGED. This is how a distinctive\n" +
    "// Devanagari face is used without a key layout, and therefore without the\n" +
    "// risk of one. See the FONT_FILE block in LyricOverlay.jsx.\n" +
    "export const FONT_FILE = " + JSON.stringify(fontFile || "") + ";\n" +
    "export const FONT_FAMILY_NAME = " + JSON.stringify(fontFamilyName || "") + ";\n" +
    "\n// Explicit duration in seconds, when render.mjs could not let the\n" +
    "// composition probe the audio. See AUDIO_SECONDS in render.mjs.\n" +
    "export const AUDIO_SECONDS = " + (Number(seconds) || 0) + ";\n";
  fs.writeFileSync(GENERATED, body, "utf-8");
}

function copyAudio(audioPath) {
  // Remotion resolves staticFile() from public/, so the audio must sit there.
  fs.mkdirSync(PUBLIC, { recursive: true });
  const dest = path.join(PUBLIC, path.basename(audioPath));
  if (fs.existsSync(dest)) fs.rmSync(dest);
  fs.copyFileSync(audioPath, dest);
  return dest;
}

function fmt(s) {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m + ":" + r.toFixed(2).padStart(5, "0");
}

function report(cues, title) {
  console.log("\n  " + title);
  console.log("  " + cues.length + " cue(s)\n");
  cues.forEach((c, i) => {
    console.log(
      "  " + rpad(i + 1, 3) + "  " + rpad(fmt(c.time), 7) +
      "  " + rpad((c.end - c.time).toFixed(2) + "s", 7) + "  " + c.text
    );
  });
  if (cues.length) {
    let avg = 0;
    if (cues.length > 1) {
      const gaps = [];
      for (let i = 1; i < cues.length; i++) gaps.push(cues[i].time - cues[i - 1].time);
      avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    }
    console.log(
      "\n  last cue ends " + fmt(cues[cues.length - 1].end) +
      (avg ? "   |   avg gap " + avg.toFixed(2) + "s" : "")
    );
  }
  console.log("");
}

// -- one render ------------------------------------------------------------
async function run(audioPath, lrcPath) {
  if (LEGACY_FONT && FONT_FILE_ARG) {
    refuseBothFonts();
    return;
  }
  const title = path.basename(audioPath).replace(/\.[^.]+$/, "");
  rule(title);

  const lrcText = fs.readFileSync(lrcPath, "utf-8");

  // --legacy-font: convert Unicode lyrics to the Preeti-era font's key
  // sequences so the classic font actually renders (see scripts/lrc_legacy.py).
  let legacy = null;
  let renderLrc = lrcText;
  if (LEGACY_FONT) {
    const family = flag("--font") || legacyFamilyGuess(LEGACY_FONT);
    const fontPath = resolveLegacyFont(LEGACY_FONT, lrcPath);
    const convOut = path.join(HERE, "out", "_legacy-" + path.basename(lrcPath));
    fs.mkdirSync(path.dirname(convOut), { recursive: true });
    console.log("  legacy font : " + path.basename(fontPath) + " (" + family + ")");

    // Preflight: the transcoder is Python, and without it the Nepali text
    // cannot be encoded at all. Check BEFORE doing any work so the failure is
    // a sentence about Python rather than a raw ENOENT stack trace. The command
    // is literally "python" -- a Windows box that only has the "py" launcher
    // fails here too, so the hint mentions both.
    const py = pythonCommand();
    if (!py) {
      console.error("");
      console.error("  --legacy-font needs Python, and it was not found on PATH.");
      console.error("");
      console.error("  These 1990s-era Nepali fonts map ASCII keys, not Unicode, so the");
      console.error("  lyrics must be transcoded before Chromium can render them. That is");
      console.error("  what scripts/lrc_legacy.py does.");
      console.error("");
      console.error("  Fix:  install Python 3, and make sure one of `python`, `py` or");
      console.error("        `python3` runs in this shell (all three are tried, in that");
      console.error("        order, so the `py` launcher alone is fine).");
      console.error("  Check with:  python --version   (or  py --version)");
      console.error("");
      console.error("  To render without it, drop --legacy-font and use a Unicode Devanagari");
      console.error("  font instead -- see docs/FONTS.md for 9 that need no conversion.");
      console.error("");
      process.exit(1);
    }

    try {
      execFileSync(py.cmd, [
        path.join(HERE, "scripts", "lrc_legacy.py"),
        lrcPath, convOut,
        "--layout", LEGACY_LAYOUT,
        ...(LEGACY_LAYOUT_FILE ? ["--layout-file", LEGACY_LAYOUT_FILE] : []),
        "--font-family", family,
        "--font-file", path.basename(fontPath),
      ], { stdio: "inherit", cwd: HERE });
    } catch (err) {
      // Surface the real cause. lrc_legacy.py prints "not round-trip exact"
      // warnings to stderr and exits non-zero if it cannot finish, and those
      // warnings are the actual diagnostic -- do not swallow them behind a
      // generic message.
      console.error("");
      console.error("  scripts/lrc_legacy.py failed (exit " + (err.status ?? "?") + ").");
      console.error("  Any 'not round-trip exact' lines above name the word that failed");
      console.error("  to encode cleanly -- the font may not be Preeti-layout.");
      console.error("  See docs/FONTS.md for which fonts are Preeti and which are not.");
      console.error("");
      process.exit(1);
    }
    // Strip audit/metadata lines: the component gets font info via the
    // generated module, not the LRC text.
    renderLrc = fs
      .readFileSync(convOut, "utf-8")
      .split(/\r?\n/)
      .filter((l) => !/^\[(raw|ti-font|ti-fontfile):/i.test(l))
      .join("\n");
    fs.mkdirSync(path.join(PUBLIC, "fonts"), { recursive: true });
    fs.copyFileSync(fontPath, path.join(PUBLIC, "fonts", path.basename(fontPath)));
    legacy = { family, file: path.basename(fontPath) };
  }

  // --font-file: a local .ttf used AS IS, with the lyrics unchanged.
  //
  // This is how a distinctive Devanagari face gets used without a key layout,
  // and therefore without the risk of one. It is NOT a legacy font: nothing is
  // transcoded, so there is no layout that can render the wrong letters, and
  // there is no round-trip to come out wrong. The 58 Unicode Devanagari fonts
  // in nepali-legacy-fonts -- many of them display faces -- are all reachable
  // this way.
  //
  // It has to be a separate flag rather than a variant of --legacy-font,
  // because --legacy-font also implies "convert the text to Preeti keys", and
  // running that on a Unicode font produces keys the font has no glyphs for:
  // silently, and with a video that looks fine.
  let fontFile = null;
  let fontFamilyName = null;
  // FONT_FILE_ARG was validated against --legacy-font at the top of this file,
  // before either was resolved, so the `if (legacy)` check that used to be here
  // is gone: it could only fire after the legacy path had already succeeded.
  if (FONT_FILE_ARG) {
    const found = [FONT_FILE_ARG, path.join(path.dirname(lrcPath), FONT_FILE_ARG),
      path.join(path.dirname(lrcPath), "..", "01 Fonts", FONT_FILE_ARG),
    ].find((p) => fs.existsSync(p));
    if (!found) {
      console.error("  Font file not found: " + FONT_FILE_ARG);
      console.error("  Looked in: " + FONT_FILE_ARG + ", beside the .lrc, and ../01 Fonts");
      process.exitCode = 1;
      return;
    }
    // The family name is read out of the font itself rather than taken from
    // --font, because the two disagree more often than not ("Yantramanav" in
    // the file, "Yantra Manav" in a README) and a mismatch means the CSS
    // silently falls through to the system font.
    const familyName =
      flag("--font") || readFontFamily(found) || path.basename(found, ".ttf");
    fontFile = path.basename(found);
    fontFamilyName = familyName;
    fs.mkdirSync(path.join(PUBLIC, "fonts"), { recursive: true });
    fs.copyFileSync(found, path.join(PUBLIC, "fonts", fontFile));
    console.log("  font file : " + found);
    console.log("  family    : " + JSON.stringify(familyName) + "  (from the font, not a flag)");
  }

  // Imported dynamically so the exact same parser the component uses is the
  // one producing this report -- no second copy to drift.
  const { parseLrc } = await import(
    "file://" + path.join(HERE, "src", "parse-lrc.mjs").replace(/\\/g, "/")
  );
  // Song Timer's "For Remotion AI" export writes the end timings in a
  // companion file beside the .lrc. It cannot go in the .lrc itself: AbleSet
  // turns every timestamp into a MIDI clip, so a second stamp would show the
  // lyric twice in Ableton.
  //
  // It is named per target now -- Song.remotion_start.lrc beside
  // Song.remotion_end.lrc -- because the AbleSet export is ALSO called
  // Song.lrc, and two files with one name and different content is how the
  // wrong one gets dragged into Ableton.
  //
  // Found by name, in order of preference: an explicit --ends, then the
  // current Song.remotion_end.lrc, then the old Song.ends.txt. Folders
  // exported before the rename must keep rendering, so neither convention is
  // dropped.
  //
  // The "_start" has to come OFF the base before "_end" goes on. Deriving the
  // end name by appending alone gave Song.remotion_start.remotion_end.lrc,
  // which is not the name Song Timer writes -- so the lookup missed, the render
  // fell back to estimating every end, and it exited 0. That is the exact
  // failure the ends file exists to prevent, reintroduced by the rename.
  //
  // A separator is required before "start" so a song genuinely called
  // "Restart" is not rewritten to "Re.remotion_end.lrc".
  //
  // Reading is done HERE, not in parse-ends.mjs, because that module is
  // bundled for the browser and cannot use "fs".
  const lrcBase = lrcPath.replace(/\.lrc$/i, "");
  const pairBase = lrcBase.replace(/[._-](?:remotion_)?start$/i, "");
  const endsCandidates = flag("--ends")
    ? [flag("--ends")]
    : [
        pairBase + ".remotion_end.lrc",
        pairBase + ".ends.txt",
      ];
  const endsPath =
    endsCandidates.find((p) => fs.existsSync(p)) || endsCandidates[0];
  const endsFound = endsCandidates.some((p) => fs.existsSync(p));
  // If the .lrc is clearly one half of a pair and no half was found, say so by
  // name. "none found" alone is indistinguishable from never having tapped
  // ends, and the two need different fixes.
  const looksPaired = pairBase !== lrcBase;
  let endsText = null;
  if (fs.existsSync(endsPath)) {
    try {
      endsText = fs.readFileSync(endsPath, "utf-8");
    } catch (err) {
      console.error("  Could not read " + endsPath + ": " + err.message);
    }
  }
  const parsed = parseLrc(renderLrc, endsText);
  // The report is generated from the parse result, so it is the single source
  // of truth for what was applied.
  const endsFile = {
    loaded: parsed.hasEnds || endsText != null,
    problems: endsText == null ? [] : (await import(
      "file://" + path.join(HERE, "src", "parse-ends.mjs").replace(/\\/g, "/")
    )).parseEnds(endsText).problems,
  };

  if (!parsed.cues.length) {
    console.error("  No timed lines found in the .lrc -- nothing to render.");
    process.exitCode = 1;
    return;
  }

  report(parsed.cues, parsed.title || title);

  // Say where the ends came from. A video that silently mixes real and guessed
  // ends is impossible to trust, and this is the only place that shows it.
  // "timed-clamped" counts: it came from the tapped file, adjusted to the
  // next line's start because the singer's tail ran a fraction past it. Only
  // "estimated" means the tapping was thrown away entirely.
  const timed = parsed.cues.filter(
    (c) => c.endFrom === "timed" || c.endFrom === "timed-clamped"
  ).length;
  const clamped = parsed.cues.filter((c) => c.endFrom === "timed-clamped").length;
  if (endsFile.loaded) {
    const pct = Math.round((timed / parsed.cues.length) * 100);
    console.log("  ends       : " + timed + "/" + parsed.cues.length +
      " timed from " + path.basename(endsPath) + " (" + pct + "%)" +
      (clamped ? "  [" + clamped + " clamped to the next line's start]" : ""));
    if (endsFile.problems.length) {
      console.log("               " + endsFile.problems.length +
        " problem line(s) in that file, ignored:");
      for (const p of endsFile.problems.slice(0, 5)) console.log("                 " + p);
    }
    // An ends file that mostly cannot be applied is the signature of a
    // different take of the song. Rendering it anyway would quietly reproduce
    // the old estimate while looking as though the ends had been applied, so
    // it stops here and says why. --allow-stale-ends overrides.
    if (timed < parsed.cues.length && !has("--allow-stale-ends")) {
      console.error("");
      if (timed === 0) {
        console.error("  None of the ends in " + path.basename(endsPath) +
          " match this .lrc.");
      } else {
        console.error("  Only " + timed + " of " + parsed.cues.length +
          " ends could be applied; the rest were rejected as stale.");
      }
      console.error("  That usually means the .lrc and the ends file are from");
      console.error("  different sessions, or the lyrics were re-timed after the");
      console.error("  ends were recorded.");
      console.error("");
      console.error("  Re-export both from Song Timer, or pass --allow-stale-ends");
      console.error("  to render anyway using the estimates for the rest.");
      console.error("");
      process.exitCode = 1;
      return;
    }
  } else {
    console.log("  ends       : none found, estimating from the next line");
    if (looksPaired) {
      // The .lrc is named like one half of a pair, so an ends file was
      // expected. Name the exact path that was looked for: a wrong name is a
      // rename away from working, and "none found" gives no way to find it.
      console.log(
        "               looked for " + path.basename(endsCandidates[0]) +
          " and " + path.basename(endsCandidates[1]) +
          " beside the .lrc -- neither is there"
      );
      console.log(
        "               (Song Timer 'For Remotion AI' writes both halves; " +
          "if you renamed one, rename the other to match)"
      );
    } else {
      console.log(
        "               (Song Timer 'For Remotion AI' writes one; put it beside the .lrc)"
      );
    }
  }

  // --check runs the preflight script and stops. At 25-30 songs this replaces
  // discovering a mistimed chorus after a four-minute render.
  if (has("--check")) {
    const checker = path.join(HERE, "scripts", "check_song.mjs");
    const code = spawnSync(process.execPath, [checker, lrcPath, endsPath], {
      stdio: "inherit",
      cwd: HERE,
    }).status;
    process.exitCode = code || 0;
    return;
  }

  const MODES = ["center", "roam", "horizontal", "vertical", "mix"];
  const MODE = flag("--mode") || "";
  if (MODE && !MODES.includes(MODE)) {
    console.error('  Unknown --mode "' + MODE + '". Use ' + MODES.join(", ") + ".");
    process.exitCode = 1;
    return;
  }

  // The mix options are validated HERE, before --report-only returns, so a bad
  // --mix-block is caught on the cheap dry run rather than after the encoding
  // step. Nothing here touches `props` or `seed`: both are declared further
  // down, and reading them from up here is a temporal dead zone error. The
  // values are carried in MIX and copied over where they exist.
  let MIX = null;
  if (MODE === "mix") {
    const block = Number(flag("--mix-block")) || 8;
    if (block < 4) {
      // Not a clamp-without-telling: a presentation every four cues is already
      // at the edge of readable, and one cue per presentation is a flicker.
      console.error(
        "  --mix-block " + block + " is too small. The minimum is 4 cues per " +
          "presentation, because at Allare's median 1.4s a cue, anything less " +
          "is a flicker rather than variety."
      );
      process.exitCode = 1;
      return;
    }
    MIX = { block, spec: flag("--mix-plan") || "" };
  }
  if (REPORT_ONLY) return;

  // --prepare-only is handled further down, once the props exist. It has to be
  // down there: it prints a `remotion still` command that passes
  // --props=out/props.json, and the only way to honour that is to actually
  // write that file. It used to return here and then suggest a props file
  // nothing had ever written, so following the hint rendered a still with
  // DEFAULT props -- wrong font size, wrong position, no word animation -- and
  // it looked plausible, which is the whole problem with a font check.

  const style = flag("--style");
  if (style && !STYLES.includes(style)) {
    console.error('  Unknown style "' + style + '". Choose from: ' + STYLES.join(", "));
    process.exitCode = 1;
    return;
  }

  // --no-audio: the composition gets no <Audio> at all, so the overlay is a
  // pure text layer. --muted is passed anyway as belt-and-braces so no audio
  // stream can ever appear in the container.
  //
  // That also means the composition cannot probe the audio for its length, so
  // the length falls back to the last cue's estimated end. Warn loudly
  // rather than shipping a file that stops before the song does.
  if (NO_AUDIO && !explicitSeconds) {
    console.warn(
      "  note: --no-audio with no --length.\n" +
      "        The video will end where the last lyric ends, which is an\n" +
      "        ESTIMATE from the next line's start. If the song runs on\n" +
      "        after the final lyric, this file will be short.\n" +
      "        Pass --length <seconds> to set the real duration.\n"
    );
  }
  if (NO_AUDIO) {
    writeGenerated(renderLrc, "", legacy, explicitSeconds, fontFile, fontFamilyName);
  } else {
    const audioName = copyAudio(audioPath);
    writeGenerated(renderLrc, "/" + path.basename(audioName), legacy, explicitSeconds, fontFile, fontFamilyName);
  }

  const outDir = path.join(HERE, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const defaultExt = PREVIEW ? ".mp4" : FORMAT === "mov" ? ".mov" : ".mp4";
  const outPath = flag("--out") || path.join(outDir, title + defaultExt);

  // Style travels as composition PROPS, not environment variables. Remotion
  // statically replaces process.env.X at build time, and an unset variable
  // becomes the literal string "undefined" -- truthy, so
  // `process.env.LYRIC_COLOR || "#ffffff"` yields "undefined": an invalid CSS
  // colour that silently renders the text black. Number("undefined") is NaN, so
  // the font size collapses to the browser default as well.
  // FPS as a PROP (see Root.jsx): env vars get baked into the cached bundle
  // and a changed LYRIC_FPS was silently ignored on re-render.
  const fps = Number(flag("--fps")) || (PREVIEW ? 15 : FORMAT === "mov" ? 60 : 30);
  const props = { fps };
  // Title cards. The window is derived from the song's own first/last lyric
  // (src/opener.js), so these are on/off switches rather than numbers to keep
  // in step with the timings by hand. The title and band come from the .lrc's
  // [ti:] and [ar:] and are parsed inside the component.
  if (has("--title-card")) props.titleCard = true;
  if (has("--title-card-outro")) {
    props.titleCard = true;
    props.titleCardOutro = true;
  }
  if (style) props.style = style;
  if (flag("--size")) props.fontSize = Number(flag("--size"));
  if (flag("--color")) props.color = flag("--color");
  if (flag("--position")) props.position = flag("--position");
  const seed = flag("--seed") || parsed.title || title;
  props.seed = seed;
  if (flag("--shadow")) props.shadow = flag("--shadow");
  // --mode = how a line is PLACED. Independent of --word-anim, which controls
  // how it is animated once placed.
  //   center     (default) lines stack in the middle, outgoing drifts up
  //   roam       each line gets its own seeded spot (reference-video look)
  //   horizontal one left-aligned band, lines stack down -- the karaoke look,
  //              where the eye follows one line instead of chasing a word that
  //              moves every line. Pair it with --word-anim karaoke.
  //   vertical   one centred narrow column, lines stack down
  //   mix        all of the above, planned across the song (--mix-block,
  //              --mix-plan). A presentation is a placement AND a unit, word
  //              or phrase, so --word-anim applies to the word blocks only.
  //
  // MODE was validated and MIX resolved before --report-only returned, so the
  // plan can be printed on the dry run. The values are copied into props HERE
  // because props does not exist up there.
  if (MODE) props.mode = MODE;
  if (MIX) {
    props.mixBlock = MIX.block;
    if (MIX.spec) props.mixPlanSpec = MIX.spec;
  }

  if (MODE === "mix") {
    // Print the plan. A mixed video cannot be debugged from the picture: "it
    // looked wrong at 2:40" points at nothing unless the log says what was on
    // screen at 2:40.
    //
    // A bad --mix-plan is caught here rather than allowed to throw.
    // parsePlan raises on an unknown presentation or a malformed chunk, and an
    // unhandled throw out of a CLI is a stack trace pointing at a source line,
    // which tells the person who typed the command nothing about what to type
    // instead.
    //
    // The import is outside the try because PRESENTATION_IDS is used in the
    // catch: a const declared inside the try is in its temporal dead zone in
    // the catch, so the error handler would itself throw a ReferenceError --
    // and it would do so while reporting some *other* error, which is how a
    // real "Cannot access 'seed' before initialization" ended up printed
    // underneath a paragraph about presentation names.
    const { buildMixPlan, describePlan, PRESENTATION_IDS } =
      await import("./src/mix.js");
    try {
      const plan = buildMixPlan({
        seed,
        cueCount: parsed.cues.length,
        block: MIX.block,
        spec: MIX.spec,
      });
      console.log(
        "  mix plan (" + plan.length + " cues, " +
          new Set(plan.map((p) => p.id)).size + " presentations):"
      );
      for (const line of describePlan(plan)) console.log("    " + line);
    } catch (err) {
      console.error("  " + (err && err.message ? err.message : String(err)));
      // Only nudge about the syntax when the error really is about the plan,
      // so a genuine bug is not buried under advice that does not apply.
      if (MIX.spec) {
        console.error("  The eight presentations are: " + PRESENTATION_IDS.join(", "));
        console.error("  A chunk looks like  0-7:h-word  or  16+:*  (0-based cue indices).");
      }
      process.exitCode = 1;
      return;
    }
  }

  // Random font size. "word" varies each word of a line, "phrase" scales the
  // whole line once, "off" disables it. --size-var is the max deviation from
  // 1.0 (0.15 = 85%..115%) and is clamped: past 0.45 the small words stop
  // being readable at 1080p, which is the opposite of what this is for.
  const SIZE_MODE = flag("--size-mode") || "word";
  if (!["off", "phrase", "word"].includes(SIZE_MODE)) {
    console.error('  Unknown --size-mode "' + SIZE_MODE + '". Use word, phrase or off.');
    process.exit(1);
  }
  props.sizeMode = SIZE_MODE;
  const sizeVarRaw = Number(flag("--size-var"));
  props.sizeVar = Number.isFinite(sizeVarRaw)
    ? Math.min(Math.max(sizeVarRaw, 0), 0.45)
    : 0.15;
  // Word-by-word animation. Each word is scheduled across the cue's span by
  // character count (src/word-timing.js) and animates as it arrives, while
  // still keeping the line's own entrance/exit. "off" keeps whole-line
  // animation, which is the previous behaviour.
  const WORD_ANIM = flag("--word-anim") || "off";
  if (!["off", "reveal", "karaoke", "pulse"].includes(WORD_ANIM)) {
    console.error('  Unknown --word-anim "' + WORD_ANIM + '". Use off, reveal, karaoke or pulse.');
    process.exit(1);
  }
  props.wordAnim = WORD_ANIM;
  // Per-letter layer, nested inside each word span. Animation is safe at any
  // strength; per-letter SIZE is clamped hard (0.12) because Devanagari's
  // shirorekha runs continuously across a word and bigger steps snap it in two.
  const LETTER_ANIM = flag("--letter-anim") || "off";
  if (!["off", "fade", "rise", "pop", "wipe"].includes(LETTER_ANIM)) {
    console.error('  Unknown --letter-anim "' + LETTER_ANIM + '". Use off, fade, rise, pop or wipe.');
    process.exit(1);
  }
  props.letterAnim = LETTER_ANIM;
  const letterVarRaw = Number(flag("--letter-var"));
  props.letterVar = Number.isFinite(letterVarRaw)
    ? Math.min(Math.max(letterVarRaw, 0), 0.03)
    : 0;
  // mp4 has no alpha: paint the background black so Add/Screen blend keying
  // is exact. mov keeps a transparent background.
  props.background = FORMAT === "mov" ? "transparent" : "#000000";
  // The preview length cap lives in calculateMetadata, next to the rest of
  // the duration maths. It used to be a --frames range on the command line,
  // computed from a different number, and the two disagreed (see Root.jsx).
  props.preview = PREVIEW;

  // The font's measured width coefficients, so the auto-fit counts wrapped
  // lines from a measurement instead of a guess. See widthTableFor() for the
  // three guesses this replaced and why each was wrong.
  //
  // A legacy font is keyed by the family it registers under, not by the file,
  // because the calibration is of the face the browser will use.
  const widthInfo = widthTableFor(
    legacy ? legacy.family : fontFamilyName || flag("--font"),
    lrcPath
  );
  if (widthInfo.table) {
    props.widthModel = widthInfo.table;
    // A legacy font uses the per-code-point model, a Unicode font the
    // per-class one. Printing the per-class names for a per-char table showed
    // a row of dashes and looked like the font had no coefficients at all.
    const t = widthInfo.table;
    const c = typeof t.perChar === "number"
      ? "per code point " + t.perChar.toFixed(4) + " em  (legacy key font)"
      : ["cons", "matra", "space", "other"]
          .map((k) => k + " " + (t[k] == null ? "-" : t[k]))
          .join("  ");
    console.log(
      "  font      : " + (legacy ? legacy.family : flag("--font") || "(default stack)") +
        "   " + (widthInfo.song ? "fitted on this song's lines" : "per-font only") +
        "\n              width em: " + c +
        "\n              leave-one-out error " +
        (t.worstError * 100).toFixed(1) + "%" +
        (t.calibratedOn ? ", measured on " + t.calibratedOn : "")
    );
  } else {
    // Said out loud, and with the command to fix it, because the fallback is
    // exactly the thing that made the delivered render too small -- and a
    // silent 0.55 is how it shipped in the first place.
    console.warn(
      "  note: no width table for this font (" + widthInfo.note + ")\n" +
        "        The auto-fit falls back to per-class defaults, which are the old\n" +
        "        0.55em constant written out. Text may be smaller than it needs to\n" +
        "        be, or a long line may run off the bottom of the frame."
    );
  }

  // --prepare-only: do the encoding and font registration, write the props the
  // still command needs, then stop. This is how a new legacy font gets checked
  // in seconds instead of after a four-minute render.
  //
  // Nothing here is a shortcut around the render: it is the same code path up
  // to the point where the render would begin. The audio is deliberately NOT
  // copied in, because a still frame has no audio and copying it would leave a
  // 6 MB file in public/ for nothing.
  if (PREPARE_ONLY) {
    writeGenerated(renderLrc, "", legacy, 0, fontFile, fontFamilyName);
    const propsPath = path.join(outDir, "props.json");
    fs.writeFileSync(propsPath, JSON.stringify(props, null, 2), "utf8");
    console.log("  prepared src/lyrics.generated.js" + (legacy ? " (+ " + legacy.file + ")" : ""));
    console.log("  wrote " + path.relative(HERE, propsPath));
    // The frame is the middle of the LONGEST cue, not a fixed number: that is
    // the frame most likely to wrap, clip or fall back to a different typeface,
    // so it is the one worth looking at. A hard-coded 5900 happened to land on
    // a short line for every song tried, which made the check look like it had
    // passed.
    let worst = parsed.cues[0];
    for (const c of parsed.cues) {
      if (!worst || c.text.length > worst.text.length) worst = c;
    }
    const mid = Math.round(
      ((worst ? worst.time + (worst.end - worst.time) / 2 : 0) || 0) * fps
    );
    console.log(
      "  next: npx remotion still src/index.js LyricOverlay out/check.png " +
        "--frame=" + mid + " --props=" + path.relative(HERE, propsPath) +
        "\n        (longest cue: " + (worst ? worst.text.length : 0) +
        " characters at " + (worst ? worst.time.toFixed(2) : 0) + "s)"
    );
    return;
  }

  // Format-specific codec flags. ProRes 4444 carries a real alpha channel
  // and must stay PNG-frame (JPEG has no alpha); H.264 cannot hold alpha, so
  // the mp4 is white-on-black for blend-mode keying and takes JPEG frames
  // (~15% faster measured) plus 30fps to match the proven Videosync2 source.
  //
  // GPU ENCODING (--gpu)
  // ----------------------
  // Remotion silently ignores --hardware-acceleration whenever --crf is set
  // and prints "crf option is not supported with hardware acceleration", so
  // crf and a hardware encoder are mutually exclusive. The way to actually
  // use one is bitrate mode: --video-bitrate instead of --crf. At 1080p, 8M
  // measures the same as the crf-17 preset this file used, so --gpu swaps the
  // quality knob for a real GPU encode and nothing else.
  //
  // The value is "if-possible", NOT "nvenc". Remotion takes no encoder name
  // here -- the option is only disable | if-possible | required, and it picks
  // whatever the machine's ffmpeg supports, so an AMD box uses VA-API and
  // "nvenc" is not merely wrong but rejected outright before ffmpeg is ever
  // reached:
  //   Error: Invalid value for --hardware-acceleration: nvenc
  // "required" is also wrong here: it fails the whole render when no
  // hardware encoder exists, which is a worse outcome than quietly encoding
  // in software. "if-possible" tries, and falls back rather than dying.
  //
  // --gl=angle (below) is the other half of the GPU: that is the headless
  // Chromium rasteriser, and it is what draws the frames at all.
  const GPU = has("--gpu");
  const formatFlags = PREVIEW
    ? ["--scale=0.25", "--fps=15", "--codec=h264", "--crf=30"]
    : FORMAT === "mov"
      ? ["--codec=prores", "--prores-profile=4444", "--pixel-format=yuva444p10le"]
      // NOTE: do NOT pass the CLI --fps here. It OVERRIDES the composition
      // after metadata resolution and CLAMPS the frame count (a 30s
      // composition came out as 900 frames = 15s -- half the song). FPS
      // travels via props to calculateMetadata, which resolves it correctly.
      : GPU
        ? ["--codec=h264", "--video-bitrate=8M", "--pixel-format=yuv420p",
           "--image-format=jpeg", "--hardware-acceleration=if-possible"]
        : ["--codec=h264", "--crf=17", "--pixel-format=yuv420p", "--image-format=jpeg"];

  // GPU rasterisation for the headless Chromium that draws the frames is a
  // Remotion CLI flag, not an env var, so it goes on the command line.
  // `angle` is Remotion's default and uses the real GPU; `swiftshader` is the
  // software rasteriser, kept as the escape hatch for machines where ANGLE
  // fails to initialise.
  const glFlag = GPU ? ["--gl=" + (flag("--gl") || "angle")] : [];

  const cliArgs = [
    "render", "src/index.js", "LyricOverlay", outPath,
    ...formatFlags,
    ...glFlag,
    ...(NO_AUDIO ? ["--muted"] : []),
    "--props=" + JSON.stringify(props),
  ];

  console.log("  seed : " + seed);
  console.log(
    "  mode : " +
    (PREVIEW ? "PREVIEW (fast)" : FORMAT === "mov" ? "FINAL (ProRes 4444, alpha)" : "FINAL (H.264 mp4, black bg -- blend Add/Screen)") +
    (NO_AUDIO ? " | text-only, no audio track" : "") +
    "\n"
  );

  // Only width/height stay as env vars; they are plain numbers read with
  // Number() and an unset one becomes NaN rather than a truthy string.
  const env = { ...process.env };
  if (flag("--font")) env.LYRIC_FONT = flag("--font");

  const cliJs = path.join(HERE, "node_modules", "@remotion", "cli", "remotion-cli.js");
  if (!fs.existsSync(cliJs)) {
    console.error("  Remotion CLI not found. Run: npm install");
    process.exitCode = 1;
    return;
  }

  if (has("--debug-args")) console.log("  ARGS: " + JSON.stringify([cliJs, ...cliArgs], null, 1));
  execFileSync(process.execPath, [cliJs, ...cliArgs], {
    stdio: "inherit",
    cwd: HERE,
    env,
  });

  const size = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
  console.log("\n  OK  " + outPath + "  (" + (size / 1024 / 1024).toFixed(1) + " MB)");
  if (!PREVIEW) {
    console.log(
      FORMAT === "mov"
        ? "      Drop onto a Videosync2 video layer, camera underneath."
        : "      Videosync2: set the layer blend to Add or Screen -- black disappears."
    );
  }
}

// -- main ------------------------------------------------------------------
if (BATCH) {
  const files = fs.readdirSync(BATCH);
  const audio = files.filter((f) => /\.(mp3|wav|m4a|ogg|flac)$/i.test(f));
  if (!audio.length) {
    console.error("No audio files in " + BATCH);
    process.exit(1);
  }
  for (const a of audio) {
    const base = a.replace(/\.[^.]+$/, "");
    const lrc = files.find((f) => f.toLowerCase() === (base + ".lrc").toLowerCase());
    if (!lrc) {
      console.log("  skip " + a + " -- no matching .lrc");
      continue;
    }
    await run(path.join(BATCH, a), path.join(BATCH, lrc));
  }
} else {
  if (positional.length < 2) {
    console.log([
      "",
      "  render.mjs -- transparent lyric overlay from a Song Timer .lrc",
      "",
      "    node render.mjs <audio> <lyrics.lrc> [options]",
      "",
      "    --preview        fast, small, no alpha -- check timing first",
      "    --no-audio       leave the audio track out of the output",
      "    --font <family>  font family to render with",
      "    --font-file <f> use a local .ttf AS IS -- no key layout, no\n" +
        "                     conversion, so no risk of wrong letters. The family\n" +
        "                     name is read from the font, not from a flag. This\n" +
        "                     is how a distinctive Unicode Devanagari face is\n" +
        "                     used; --legacy-font is the opposite and cannot be\n" +
        "                     combined with it.",
      "    --mode <mode>    center (default) | roam (random spot per line) |\n" +
        "                     horizontal (one left-aligned band; pair with karaoke) |\n" +
        "                     vertical (one centred narrow column) |\n" +
        "                     mix (all of them, planned across the song)\n" +
        "    --mix-block <n>  cues per presentation in mix mode (default 8, min 4).\n" +
        "                     Below 4 it is a flicker, not variety: Allare's\n" +
        "                     median cue is 1.4s.\n" +
        "    --mix-plan <s>   pin a verse: \"0-7:h-word,8-15:v-phrase,16+:*\"\n" +
        "                     0-based cue indices. The eight presentations are\n" +
        "                     h-word h-phrase v-word v-phrase c-word c-phrase\n" +
        "                     r-word r-phrase; \"*\" hands back to the automatic walk.",
      "    --format <fmt>   mp4 (h264 black bg, default) | mov (prores alpha)",
      "    --legacy-font <f> use a Preeti-era font (.ttf), converting the lyrics\n                     to its key layout (needs python + npttf2utf);",
      "    --fps <n>        output frame rate (default: 30 mp4 / 60 mov)",
      "    --report-only    just print the cue list",
      "    --ends <file>    end timings; by default looked for beside the .lrc as\n                     <song>.remotion_end.lrc, then <song>.ends.txt",
      "    --allow-stale-ends  render even if most ends cannot be applied",
      "    --check          preflight only: verify timings, then exit",
      "    --title-card     show the song title + band at the start",
      "    --title-card-outro  also repeat the title at the end",
      "    --style <name>   pin one animation: " + STYLES.join(", "),
      "    --position <pos> top | center | bottom",
      "    --size <px>      font size (default 104)",
      "    --size-mode <m>  word (vary each word) | phrase | off   (default word)",
      "    --size-var <n>   how far sizes vary, 0..0.45 (default 0.15 = +-15%)",
      "    --word-anim <m>  off (default) | reveal | karaoke | pulse",
      "    --letter-anim <m>  off (default) | fade | rise | pop | wipe",
      "    --letter-var <n>   per-letter size, 0..0.03 (clamped hard: the",
      "                      shirorekha is continuous across a word)",
      "    --title-card / --title-card-outro",
      "    --color <#hex>   text colour",
      "    --seed <text>    animation seed (default: title from the .lrc)",
      "    --batch <dir>    render every audio+.lrc pair in a folder",
      ""
    ].join("\n"));
    process.exit(0);
  }
  await run(path.resolve(positional[0]), path.resolve(positional[1]));
}
