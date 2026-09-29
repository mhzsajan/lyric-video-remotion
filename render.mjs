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
const BATCH = flag("--batch");

// Which key layout the legacy font speaks. npttf2utf knows five; a font
// outside those needs a map generated from the publisher's character table
// (scripts/anepali_charmap.py) and passed here with --layout-file. Preeti is
// NOT a safe default for an arbitrary Nepali font: feeding Preeti keys to
// AMS Manthan renders collapsed glyphs and literal `==` instead of the danda.
const LEGACY_LAYOUT = flag("--layout") || "Preeti";
const LEGACY_LAYOUT_FILE = flag("--layout-file") || null;

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
function writeGenerated(lrcText, audioFile, legacy = null) {
  const esc = (s) =>
    s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  const body =
    "// GENERATED by render.mjs -- do not edit.\n\n" +
    "export const LRC_TEXT = `" + esc(lrcText) + "`;\n\n" +
    "export const AUDIO_FILE = " + JSON.stringify(audioFile || "") + ";\n\n" +
    "// Non-empty when rendering with a legacy Preeti-era font: the family to\n" +
    "// register via FontFace and the .ttf file name inside public/fonts/.\n" +
    "export const LEGACY_FONT_FILE = " + JSON.stringify(legacy ? legacy.file : "") + ";\n" +
    "export const LEGACY_FONT_FAMILY = " + JSON.stringify(legacy ? legacy.family : "") + ";\n";
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

  // Imported dynamically so the exact same parser the component uses is the
  // one producing this report -- no second copy to drift.
  const { parseLrc } = await import(
    "file://" + path.join(HERE, "src", "parse-lrc.mjs").replace(/\\/g, "/")
  );
  // Song Timer's "For Remotion AI" export writes <song>.ends.txt next to the
  // .lrc. It cannot go in the .lrc itself: AbleSet turns every timestamp into a
  // MIDI clip, so a second stamp would show the lyric twice in Ableton.
  // Looked up beside the .lrc by name, so any song folder works unchanged.
  // Reading it is done HERE, not in parse-ends.mjs, because that module is
  // bundled for the browser and cannot use "fs".
  const endsPath = flag("--ends") || lrcPath.replace(/\.lrc$/i, ".ends.txt");
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
  const timed = parsed.cues.filter((c) => c.endFrom === "timed").length;
  if (endsFile.loaded) {
    const pct = Math.round((timed / parsed.cues.length) * 100);
    console.log("  ends       : " + timed + "/" + parsed.cues.length +
      " timed from " + path.basename(endsPath) + " (" + pct + "%)");
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
      console.error("  That usually means the .lrc and the .ends.txt are from");
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
    console.log("               (Song Timer 'For Remotion AI' writes one; put it beside the .lrc)");
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

  if (REPORT_ONLY) return;

  // --prepare-only: do the encoding and font registration, then stop. Writes
  // src/lyrics.generated.js and copies the .ttf into public/fonts/, so a
  // single frame can then be rendered with `remotion still` -- which is how a
  // new legacy font gets checked in seconds instead of after a full render.
  // Nothing here is a shortcut around the render; it is the same code path
  // up to the point where the render would begin.
  if (PREPARE_ONLY) {
    writeGenerated(renderLrc, "", legacy);
    console.log("  prepared src/lyrics.generated.js" + (legacy ? " (+ " + legacy.file + ")" : ""));
    console.log("  next: npx remotion still src/index.js LyricOverlay out/check.png --frame=5900 --props=out/props.json");
    return;
  }

  const style = flag("--style");
  if (style && !STYLES.includes(style)) {
    console.error('  Unknown style "' + style + '". Choose from: ' + STYLES.join(", "));
    process.exitCode = 1;
    return;
  }

  // --no-audio: the composition gets no <Audio> at all, so the .mov is a
  // pure text overlay. --muted is passed anyway as belt-and-braces so no
  // audio stream can ever appear in the container.
  if (NO_AUDIO) {
    writeGenerated(renderLrc, "", legacy);
  } else {
    const audioName = copyAudio(audioPath);
    writeGenerated(renderLrc, "/" + path.basename(audioName), legacy);
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
  // --mode roam = every line appears at its own seeded position (the
  // reference-video style); default keeps the centered stacked look.
  if (flag("--mode")) props.mode = flag("--mode");
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

  // Format-specific codec flags. ProRes 4444 carries a real alpha channel
  // and must stay PNG-frame (JPEG has no alpha); H.264 cannot hold alpha, so
  // the mp4 is white-on-black for blend-mode keying and takes JPEG frames
  // (~15% faster measured) plus 30fps to match the proven Videosync2 source.
  //
  // GPU ENCODING (--gpu)
  // ----------------------
  // Remotion silently ignores --hardware-acceleration whenever --crf is set
  // and prints "crf option is not supported with hardware acceleration", so
  // crf and the NVENC encoder are mutually exclusive. The way to actually use
  // an NVIDIA encoder is bitrate mode: --video-bitrate instead of --crf. At
  // 1080p, 8M measures the same as the crf-17 preset this file used, so
  // --gpu swaps quality knob for a real GPU encode and nothing else.
  //
  // Measured on this machine (RTX 5070): see docs/GPU.md. It is opt-in
  // because a bitrate target and a CRF are different quality/size trades --
  // if you want a predictable file size, keep crf.
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
           "--image-format=jpeg", "--hardware-acceleration=nvenc"]
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
      "    --mode <mode>    roam (random spot per line) | center (default)",
      "    --format <fmt>   mp4 (h264 black bg, default) | mov (prores alpha)",
      "    --legacy-font <f> use a Preeti-era font (.ttf), converting the lyrics\n                     to its key layout (needs python + npttf2utf);",
      "    --fps <n>        output frame rate (default: 30 mp4 / 60 mov)",
      "    --report-only    just print the cue list",
      "    --ends <file>    end timings, default <song>.ends.txt beside the .lrc",
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
