// check_pairing.mjs -- the .lrc and the ends file must find each other by name.
//
// run:  node scripts/check_pairing.mjs
//
// WHY THIS EXISTS
// ---------------
// Song Timer used to write Song.lrc + Song.ends.txt. It now writes
// Song_ableset.lrc, Song.remotion_start.lrc + Song.remotion_end.lrc, and
// Song.obs.html, because AbleSet and the renderer both read a .lrc and the two
// were previously indistinguishable in a folder listing.
//
// Renaming one half of a pair is a quiet failure. When render.mjs looked for
// the end file by appending to the .lrc name it produced
// Song.remotion_start.remotion_end.lrc -- not the name Song Timer writes. The
// lookup missed, every cue fell back to an ESTIMATED end, and the render
// exited 0 with a plausible-looking file. That is precisely the lingering-lyric
// bug the ends file exists to fix, reintroduced by the rename that was meant to
// prevent confusion. No error, no warning, wrong video.
//
// So the pairing is asserted here, over both naming schemes and the failure
// modes that matter. The assertion is on the LINE the render prints ("109/109
// timed from X"), not on the lookup code, because the printed line is the only
// thing that proves the ends actually reached the timeline.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const RENDER = path.join(ROOT, "render.mjs");

// Two cues and their ends. Long enough that a missed lookup is unmistakable:
// an estimated end would stretch cue 1 across the whole gap to cue 2.
const LRC = `[ti:Fixture]
[00:01.00]one
[00:03.00]two
`;
const ENDS = `# Song Timings - the start and end of every timed line
# start | end | text
0:01.00 | 0:01.50 | one
0:03.00 | 0:03.50 | two
`;

let bad = 0;
const fail = (m) => {
  console.error("  FAIL " + m);
  bad++;
};
const pass = (m) => console.log("  ok   " + m);

// A 6s silent WAV, written by hand. --report-only needs a readable audio file
// to get the song length, and shelling out to ffmpeg to make silence would add
// a dependency to a test about filenames.
function silentWav(seconds, file) {
  const rate = 8000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  writeFileSync(file, buf);
}

const dir = mkdtempSync(path.join(tmpdir(), "pairing-"));
const audio = path.join(dir, "Fixture.wav");
silentWav(6, audio);

function report(lrcPath) {
  try {
    return execFileSync(process.execPath, [RENDER, audio, lrcPath, "--report-only"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // render.mjs exits non-zero when most ends cannot be applied, which is a
    // legitimate outcome for the "missing file" cases below. The output is
    // still the thing being asserted.
    return (err.stdout || "") + (err.stderr || "");
  }
}

const timedLine = (out) => out.match(/ends\s+:\s+(\d+)\/(\d+) timed from (\S+)/);
const usedEnds = (out) => {
  const m = timedLine(out);
  return m ? `${m[1]}/${m[2]}` : null;
};

try {
  // 1. Current naming: Song.remotion_start.lrc beside Song.remotion_end.lrc.
  mkdirSync(path.join(dir, "new"));
  writeFileSync(path.join(dir, "new", "Song.remotion_start.lrc"), LRC);
  writeFileSync(path.join(dir, "new", "Song.remotion_end.lrc"), ENDS);
  const newOut = report(path.join(dir, "new", "Song.remotion_start.lrc"));
  if (usedEnds(newOut) === "2/2") {
    pass("Song.remotion_start.lrc finds Song.remotion_end.lrc");
  } else {
    fail(
      "Song.remotion_start.lrc did not pick up its ends file (got " +
        (usedEnds(newOut) || "no timed line") +
        "). Appending the end suffix without stripping the start infix is the " +
        "original bug."
    );
  }
  if (/Song\.remotion_end\.lrc/.test(newOut)) {
    pass("the report names the ends file it used");
  } else {
    fail("the report does not name the ends file it used");
  }

  // 2. Old naming must keep working: folders exported before the rename.
  mkdirSync(path.join(dir, "old"));
  writeFileSync(path.join(dir, "old", "Song.lrc"), LRC);
  writeFileSync(path.join(dir, "old", "Song.ends.txt"), ENDS);
  const oldOut = report(path.join(dir, "old", "Song.lrc"));
  if (usedEnds(oldOut) === "2/2") {
    pass("Song.lrc still finds Song.ends.txt");
  } else {
    fail(
      "Song.lrc no longer finds Song.ends.txt (got " +
        (usedEnds(oldOut) || "no timed line") +
        ") -- folders exported before the rename would silently lose their ends"
    );
  }

  // 3. The new legacy name, on a new-style .lrc. Both halves named "remotion"
  //    but only the end half renamed is a real half-renamed folder.
  mkdirSync(path.join(dir, "mixed"));
  writeFileSync(path.join(dir, "mixed", "Song.remotion_start.lrc"), LRC);
  writeFileSync(path.join(dir, "mixed", "Song.ends.txt"), ENDS);
  if (usedEnds(report(path.join(dir, "mixed", "Song.remotion_start.lrc"))) === "2/2") {
    pass("a .remotion_start.lrc also accepts the older Song.ends.txt");
  } else {
    fail("a .remotion_start.lrc cannot find a Song.ends.txt beside it");
  }

  // 4. A song genuinely called "Restart" must not have its name rewritten.
  //    "restart" ends in "start", so a regex without a required separator turns
  //    Restart.lrc into Re.remotion_end.lrc and finds nothing.
  mkdirSync(path.join(dir, "restart"));
  writeFileSync(path.join(dir, "restart", "Restart.lrc"), LRC);
  writeFileSync(path.join(dir, "restart", "Restart.ends.txt"), ENDS);
  const rOut = report(path.join(dir, "restart", "Restart.lrc"));
  if (usedEnds(rOut) === "2/2") {
    pass("a song named Restart is not mangled by the start-suffix strip");
  } else {
    fail(
      "Restart.lrc does not find Restart.ends.txt (got " +
        (usedEnds(rOut) || "no timed line") +
        ") -- the strip must require a separator before start"
    );
  }

  // 5. Half a pair: the .lrc says it wants an ends file and there is none.
  //    This must be NAMED, because "none found" is indistinguishable from never
  //    having tapped ends, and the two need different fixes.
  mkdirSync(path.join(dir, "half"));
  writeFileSync(path.join(dir, "half", "Song.remotion_start.lrc"), LRC);
  const halfOut = report(path.join(dir, "half", "Song.remotion_start.lrc"));
  if (usedEnds(halfOut) === null) {
    pass("a missing ends file is reported, not silently estimated");
  } else {
    fail("a missing ends file was not reported");
  }
  if (/looked for .*Song\.remotion_end\.lrc/.test(halfOut)) {
    pass("a missing ends file is named by path");
  } else {
    fail(
      "a missing ends file is not named by path, so a half-renamed folder " +
        "gives no way to find the mismatch"
    );
  }

  // 6. An explicit --ends must win over both conventions.
  writeFileSync(path.join(dir, "half", "Elsewhere.txt"), ENDS);
  let override = "";
  try {
    override = execFileSync(
      process.execPath,
      [RENDER, audio, path.join(dir, "half", "Song.remotion_start.lrc"),
       "--report-only", "--ends", path.join(dir, "half", "Elsewhere.txt")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (err) {
    override = (err.stdout || "") + (err.stderr || "");
  }
  if (usedEnds(override) === "2/2" && /Elsewhere\.txt/.test(override)) {
    pass("--ends overrides both naming conventions");
  } else {
    fail("--ends did not override the looked-up names");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("");
if (bad) {
  console.log("  " + bad + " problem(s).");
  process.exit(1);
}
console.log("  the .lrc and the ends file find each other in every scheme.");
