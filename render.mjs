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

import { execFileSync } from "node:child_process";
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
    execFileSync("python", [
      path.join(HERE, "scripts", "lrc_legacy.py"),
      lrcPath, convOut,
      "--layout", "Preeti",
      "--font-family", family,
      "--font-file", path.basename(fontPath),
    ], { stdio: "inherit", cwd: HERE });
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
  const parsed = parseLrc(renderLrc);

  if (!parsed.cues.length) {
    console.error("  No timed lines found in the .lrc -- nothing to render.");
    process.exitCode = 1;
    return;
  }

  report(parsed.cues, parsed.title || title);

  if (REPORT_ONLY) return;

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

  // Format-specific codec flags. ProRes 4444 carries a real alpha channel
  // and must stay PNG-frame (JPEG has no alpha); H.264 cannot hold alpha, so
  // the mp4 is white-on-black for blend-mode keying and takes JPEG frames
  // (~15% faster measured) plus 30fps to match the proven Videosync2 source.
  const formatFlags = PREVIEW
    ? ["--scale=0.25", "--fps=15", "--codec=h264", "--crf=30"]
    : FORMAT === "mov"
      ? ["--codec=prores", "--prores-profile=4444", "--pixel-format=yuva444p10le"]
      // NVENC (NVIDIA-only per Remotion docs) auto-enables when available;
      // on AMD/Intel this silently falls back to software x264.
      // NOTE: do NOT pass the CLI --fps here. It OVERRIDES the composition
      // after metadata resolution and CLAMPS the frame count (a 30s
      // composition came out as 900 frames = 15s -- half the song). FPS
      // travels via props to calculateMetadata, which resolves it correctly.
      : ["--codec=h264", "--crf=17", "--pixel-format=yuv420p", "--image-format=jpeg", "--hardware-acceleration=if-possible"];

  const cliArgs = [
    "render", "src/index.js", "LyricOverlay", outPath,
    ...formatFlags,
    ...(NO_AUDIO ? ["--muted"] : []),
    // Preview only needs to reach the last sung line: without this it renders
    // the full composition -- at 15 fps that stretches 25k frames into a
    // 27-minute timeline and mostly encodes silence. -1: frame INDEX max is
    // duration-1 (0-5242 of a 5242-frame comp is an off-by-one error).
    ...(PREVIEW && parsed.cues.length
      ? ["--frames=0-" + (Math.round((parsed.cues[parsed.cues.length - 1].end + 2) * 15) - 1)]
      : []),
    "--props=" + JSON.stringify(props),
  ];

  console.log("  seed : " + seed);
  console.log(
    "  mode : " +
    (PREVIEW ? "PREVIEW (fast)" : FORMAT === "mov" ? "FINAL (ProRes 4444, alpha)" : "FINAL (H.264 mp4, black bg -- blend Add/Screen)") +
    (NO_AUDIO ? " | text-only, no audio track" : "") +
    "\n"
  );

  // Only width/height/fps stay as env vars; they are plain numbers read with
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
      "    --style <name>   pin one animation: " + STYLES.join(", "),
      "    --position <pos> top | center | bottom",
      "    --size <px>      font size (default 104)",
      "    --size-mode <m>  word (vary each word) | phrase | off   (default word)",
      "    --size-var <n>   how far sizes vary, 0..0.45 (default 0.15 = +-15%)",
      "    --word-anim <m>  off (default) | reveal | karaoke | pulse",
      "    --letter-anim <m>  off (default) | fade | rise | pop | wipe",
      "    --letter-var <n>   per-letter size, 0..0.03 (clamped hard: the",
      "                      shirorekha is continuous across a word)",
      "    --color <#hex>   text colour",
      "    --seed <text>    animation seed (default: title from the .lrc)",
      "    --batch <dir>    render every audio+.lrc pair in a folder",
      ""
    ].join("\n"));
    process.exit(0);
  }
  await run(path.resolve(positional[0]), path.resolve(positional[1]));
}
