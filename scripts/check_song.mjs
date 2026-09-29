// Preflight a song before spending minutes rendering it.
//
// At 25-30 songs, a mistyped timestamp, a duplicated chorus line or an ends
// file from a different take is invisible until you watch the video. Every check
// here runs in well under a second and would otherwise cost a full render to
// discover.
//
//   node scripts/check_song.mjs <lrc> [ends]
import { readFileSync, existsSync } from "fs";
import { parseLrc } from "../src/parse-lrc.mjs";
import { parseEnds } from "../src/parse-ends.mjs";
import { wordTimings } from "../src/word-timing.js";

const LRC = process.argv[2];
if (!LRC) {
  console.log("usage: node scripts/check_song.mjs <lrc> [ends.txt]");
  process.exit(2);
}
const ENDS = process.argv[3] || LRC.replace(/\.lrc$/i, ".ends.txt");

let errors = 0;
let warnings = 0;
const fail = (m) => { errors++; console.log("  ERROR  " + m); };
const warn = (m) => { warnings++; console.log("  warn   " + m); };
const ok = (m) => console.log("  ok     " + m);

if (!existsSync(LRC)) {
  fail("no such .lrc: " + LRC);
  process.exit(1);
}
const lrcText = readFileSync(LRC, "utf-8");
const endsText = existsSync(ENDS) ? readFileSync(ENDS, "utf-8") : null;

console.log("  " + LRC);
console.log("  " + (existsSync(ENDS) ? ENDS : "(no ends file)"));

const { cues, title, band, hasEnds } = parseLrc(lrcText, endsText);
if (!cues.length) {
  fail("no timed lines at all");
  process.exit(1);
}

console.log("\n  -- basics --");
ok(cues.length + " cues" + (title ? ", title: " + title : "") + (band ? ", band: " + band : ""));
if (!title) warn("no [ti:] title -- it seeds the animation, so an empty one means a shared default");

console.log("\n  -- ordering and spans --");
let disorder = 0;
let badSpan = 0;
let zero = 0;
for (let i = 0; i < cues.length; i++) {
  const c = cues[i];
  if (i > 0 && c.time < cues[i - 1].time) disorder++;
  if (c.end <= c.time) badSpan++;
  if (c.end - c.time < 0.3) zero++;
}
if (disorder) fail(disorder + " cue(s) out of order");
else ok("cues are in time order");
if (badSpan) fail(badSpan + " cue(s) end at or before they start");
else ok("every line has a positive span");
if (zero) warn(zero + " line(s) visible for under 0.3s -- probably too tight to read");

console.log("\n  -- ends --");
if (endsText == null) {
  warn("no .ends.txt beside the .lrc -- ends are estimated from the next line,");
  console.log("         which leaves a line on screen up to 8s after it is sung");
} else {
  const { ends, problems } = parseEnds(endsText);
  if (problems.length) {
    for (const p of problems.slice(0, 6)) fail("ends file: " + p);
    if (problems.length > 6) console.log("         ...and " + (problems.length - 6) + " more");
  } else ok("ends file parses cleanly");
  const timed = cues.filter((c) => c.endFrom === "timed").length;
  const pct = Math.round((timed / cues.length) * 100);
  if (timed === cues.length) {
    ok("every cue has a real end (" + pct + "%)");
  } else if (timed === 0) {
    // A file that matches nothing usable is almost certainly from a different
    // take, and rendering it silently would just reproduce the old estimate
    // while looking like the ends had been applied.
    fail("no end from this file could be used (" + pct + "% applied) -- " +
      "it looks like a different take of the song");
  } else {
    fail(timed + "/" + cues.length + " cues timed (" + pct + "%): " +
      (cues.length - timed) + " rejected as stale. Check the .lrc and .ends.txt are from the same session");
  }
  const orphans = [...ends.keys()].filter((k) => !cues.some((c) => Math.round(c.time * 100) === k));
  if (orphans.length) warn(orphans.length + " end(s) in the file match no line in the .lrc -- it may be from a different take");
  const mismatched = cues.filter((c) => {
    const e = ends.get(Math.round(c.time * 100));
    return e && e.text && c.text && e.text.trim() !== c.text.trim();
  });
  if (mismatched.length) {
    warn(mismatched.length + " line(s) have different text in the .ends.txt -- the lyrics were re-typed after timing");
    mismatched.slice(0, 3).forEach((c) => {
      console.log("           lrc:  " + JSON.stringify(c.text.slice(0, 40)));
      console.log("           ends: " + JSON.stringify(ends.get(Math.round(c.time * 100)).text.slice(0, 40)));
    });
  }
}

console.log("\n  -- word timing (used by --word-anim) --");
let wordBad = 0;
let veryLong = 0;
for (const c of cues) {
  const w = wordTimings({ text: c.text, time: c.time, end: c.end });
  if (!w.length) { wordBad++; continue; }
  for (let i = 1; i < w.length; i++) if (w[i].start < w[i - 1].start - 1e-9) wordBad++;
  if (c.end - c.time > 3) veryLong++;
}
if (wordBad) fail(wordBad + " problem(s) in derived word timings");
else ok("every cue yields ordered word slots");
if (veryLong) warn(veryLong + " line(s) are on screen over 3s -- words will be paced slowly");

console.log("\n  -- duplicates --");
const seen = new Map();
for (const c of cues) {
  const k = c.text.trim();
  if (!k) continue;
  seen.set(k, (seen.get(k) || 0) + 1);
}
const dupes = [...seen.entries()].filter(([, n]) => n > 1);
if (dupes.length) {
  ok(dupes.length + " line(s) repeat " + Math.max(...dupes.map(([, n]) => n)) + "x -- normal for a chorus");
} else {
  ok("no repeated lines");
}

console.log("");
if (errors) {
  console.log("  " + errors + " error(s), " + warnings + " warning(s) -- do not render yet");
  process.exit(1);
}
console.log("  " + (warnings ? warnings + " warning(s), no errors" : "clean") + " -- safe to render");
