// contact_sheet.mjs -- every candidate face, side by side, on one page.
//
// run:  node scripts/contact_sheet.mjs [--out out/contact-sheet.png] [--lyric "..."]
//
// WHY A SHEET AND NOT A LIST
// -------------------------
// "Which font should the video use" is not a question a table answers. The
// candidates are all correct -- they are Unicode, so none of them can render
// the wrong letters -- and they differ only in how they LOOK. So the useful
// artefact is the type itself, at the size it will be rendered, with the
// longest real line from the song, so the choice is made on the thing that
// actually matters.
//
// Every face here is rendered through --font-file, so what is on the sheet is
// exactly what a render would draw: the same FontFace registration, the same
// text, the same size.
//
// It also prints the measured width for each, because a face that is
// dramatically wider will wrap more and the auto-fit will shrink it -- the
// "does it look small" problem is a width problem, not a taste problem.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

function flag(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

// The display and decorative Unicode Devanagari faces, by what they are for
// rather than alphabetically, because the point is to show a RANGE of looks
// rather than a complete list.
const CANDIDATES = [
  ["yantramanav", "YantraManav-Black.ttf", "heavy poster sans"],
  ["halant", null, "very heavy display"],
  ["khand", null, "condensed heavy display"],
  ["teko", null, "tall condensed"],
  ["modak", null, "rounded display"],
  ["sahitya", null, "elegant serif"],
  ["mukta", null, "clean geometric"],
  ["baloo-2", null, "rounded friendly"],
  ["palanquin-dark", null, "heavy sans"],
  ["biryani", null, "condensed sans"],
  ["rozha-one", null, "display serif"],
  ["martel", null, "serif"],
  ["arya", null, "the safe default"],
  ["kalam", null, "handwriting-ish"],
  ["rajdhani", null, "technical"],
];

function fontsRoot() {
  const cands = [
    path.join(ROOT, "..", "nepali-legacy-fonts", "fonts"),
    "C:\\Users\\Admin\\tools\\nepali-legacy-fonts\\fonts",
  ];
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}

function pickFont(root, dir) {
  const d = path.join(root, dir);
  if (!existsSync(d)) return null;
  const files = readdirSync(d).filter((f) => /\.ttf$/i.test(f));
  if (!files.length) return null;
  // Prefer a heavy face, then bold, then anything. A "custom font" look comes
  // from weight, and showing the regular of a display family undersells it.
  const order = [/black|heavy|extra/i, /bold|bd/i, /semibold|medium/i, /regular/i];
  for (const re of order) {
    const hit = files.find((f) => re.test(f));
    if (hit) return path.join(d, hit);
  }
  return path.join(d, files[0]);
}

async function main() {
  const repo = fontsRoot();
  if (!repo) {
    console.error("  nepali-legacy-fonts/fonts not found; pass --fonts <dir>");
    process.exitCode = 1;
    return;
  }
  const audio = flag("--audio", "");
  const lrc = flag("--lrc", "");
  const out = flag("--out", path.join(ROOT, "out", "contact-sheet.png"));
  if (!audio || !lrc) {
    console.error("  needs --audio <mp3> and --lrc <lrc>");
    process.exitCode = 1;
    return;
  }
  const size = flag("--size", "96");

  const { bundle } = await import("@remotion/bundler");
  const { renderStill } = await import("@remotion/renderer");

  // THE PRESENTATION IS DELIBERATELY PLAIN.
  //
  // The first attempt rendered the sheet exactly as a video render is: karaoke
  // word animation, per-letter pop, a 60px glow shadow, size 96. Every row came
  // out as a solid white blob with no letterforms visible -- the shirorekha bars
  // of adjacent glyphs merged through the glow, and the heavy display weights
  // filled what was left. The sheet was technically fifteen different fonts and
  // practically useless for choosing between them.
  //
  // A font comparison has to isolate the one variable it is comparing. So: no
  // word animation, no per-letter animation, no glow, and a size chosen to sit
  // comfortably in the band. The look being judged is the typeface, and a real
  // render adds the animation back on top of it later.
  const clean = {
    fps: 30,
    fontSize: Number(size),
    seed: "Allare",
    mode: "horizontal",
    sizeMode: "off",
    sizeVar: 0,
    wordAnim: "off",
    letterAnim: "off",
    letterVar: 0,
    // A flat, tight shadow. Enough to keep white legible on a camera feed, far
    // too little to join two glyphs together.
    shadow: "0 2px 6px rgba(0,0,0,0.75)",
    background: "#000000",
    preview: false,
  };

  const rows = [];
  for (const [slug, explicit, note] of CANDIDATES) {
    const file = explicit ? path.join(repo, slug, explicit) : pickFont(repo, slug);
    if (!file || !existsSync(file)) {
      console.log("  skip " + slug + "  (no font found)");
      continue;
    }
    // --prepare-only is the whole trick: it writes src/lyrics.generated.js with
    // the font registered, and leaves the props behind, which `still` then uses.
    // So each row is a real render path, not a mock-up.
    execFileSync(
      process.execPath,
      [
        path.join(ROOT, "render.mjs"), audio, lrc,
        "--no-audio", "--length", "30",
        "--size", size,
        "--mode", "horizontal",
        "--size-mode", "off",
        "--font-file", file,
        "--shadow", "0 2px 6px rgba(0,0,0,0.75)",
        "--prepare-only",
      ],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
    );

    const serveUrl = await bundle({
      entryPoint: path.join(ROOT, "src", "index.js"),
      onProgress: () => {},
    });

    const { selectComposition } = await import("@remotion/renderer");
    const composition = await selectComposition({
      serveUrl,
      id: "LyricOverlay",
      inputProps: clean,
    });
    const png = path.join(ROOT, "out", "sheet-" + slug.replace(/\W+/g, "_") + ".png");
    await renderStill({
      composition,
      serveUrl,
      output: png,
      frame: 5625,
      inputProps: clean,
      imageFormat: "png",
      overwrite: true,
    });

    const family = execFileSync("py", [path.join(HERE, "font_family.py"), file], {
      encoding: "utf8", windowsHide: true,
    }).trim();
    rows.push({ slug, family, file, png, note });
    console.log("  rendered " + slug.padEnd(16) + family);
  }

  if (!rows.length) {
    console.error("  nothing rendered");
    process.exitCode = 1;
    return;
  }

  // Tile them with Pillow, one label per row.
  const py = ["py", "python", "python3"].find((c) => {
    try {
      execFileSync(c, ["-c", "import PIL; pass"], { stdio: "ignore", windowsHide: true });
      return true;
    } catch {
      return false;
    }
  });
  if (!py) {
    console.error("  Pillow is needed to tile the sheet: pip install pillow");
    process.exitCode = 1;
    return;
  }
  mkdirSync(path.dirname(out), { recursive: true });
  // The list is written here rather than inside tile_sheet.py, so the Python
  // side stays a dumb tiler with no knowledge of fonts or rendering.
  const listPath = path.join(ROOT, "out", "sheet-list.txt");
  writeFileSync(
    listPath,
    rows.map((r) => r.png + "\t" + r.family + (r.note ? "  (" + r.note + ")" : "")).join("\n") + "\n",
    "utf8"
  );
  execFileSync(py, [path.join(HERE, "tile_sheet.py"), listPath, out], {
    stdio: "inherit",
    windowsHide: true,
  });
  rmSync(path.join(ROOT, "out", "sheet-list.txt"), { force: true });
  console.log("  wrote " + path.relative(ROOT, out));
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exitCode = 1;
});
