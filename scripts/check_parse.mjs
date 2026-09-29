// Assert the .ends.txt wiring: a real end must beat a guessed one, and a
// missing or mismatched file must fall back rather than produce nonsense.
//
// The whole point of the ends file is that a line clears when it is sung. If a
// bad file were trusted blindly it would be worse than the estimate it replaces,
// so the fallbacks are tested as carefully as the happy path.
import { parseLrc } from "../src/parse-lrc.mjs";
import { parseEnds, parseClock } from "../src/parse-ends.mjs";
import { readFileSync, existsSync } from "fs";
import { basename } from "path";

let failures = 0;
const check = (cond, msg) => {
  console.log((cond ? "  ok   " : "  FAIL ") + msg);
  if (!cond) failures++;
};

const LRC = process.argv[2] ||
  "D:\\DB Project\\Text Only Lyric Video Final\\Final\\Allare\\Allare Timmed.lrc";
const ENDS = process.argv[3] || LRC.replace(/\.lrc$/i, ".ends.txt");

console.log("=== parseClock ===");
check(parseClock("1:06.45") === 66.45, "m:ss.ss parses");
check(parseClock("0:08") === 8, "m:ss without fraction parses");
check(parseClock("12:00.00") === 720, "minutes over 9 parse");
check(parseClock("nope") === null, "garbage returns null");
check(parseClock("1:99") === null, "invalid seconds rejected");

console.log("\n=== parseEnds ===");
const good = [
  "# comment",
  "",
  "1:06.45 | 1:07.10 | फर्केर आउने छैन",
  "1:07.30 | 1:08.40 | म कुनै ऋतु होइन",
].join("\n");
const g = parseEnds(good);
check(g.ends.size === 2, "two ends read");
check(g.problems.length === 0, "no problems on clean input");
check(g.ends.get(6645).end === 67.1, "end value correct");

const pipy = parseEnds("1:00.00 | 1:02.00 | a | b");
check(pipy.ends.get(6000).text === "a | b", "a pipe inside the lyric is kept");

const bad = parseEnds([
  "no pipes here",
  "1:00.00 | nope | text",
  "1:10.00 | 1:05.00 | backwards",
  "1:20.00 | 1:22.00 | fine",
].join("\n"));
check(bad.problems.length === 3, "three problems reported");
check(bad.ends.size === 1, "only the good line is kept");

console.log("\n=== parseLrc with no ends (must not change behaviour) ===");
const lrcText = readFileSync(LRC, "utf-8");
const plain = parseLrc(lrcText);
check(plain.cues.length > 0, plain.cues.length + " cues parsed");
check(plain.cues.every((c) => c.endFrom === "estimated"), "all ends estimated");
check(plain.cues.every((c, i) =>
  i === 0 || c.time >= plain.cues[i - 1].time), "cues stay in order");
check(plain.cues.every((c) => c.end > c.time), "every end is after its start");

console.log("\n=== parseLrc with a synthesised ends file ===");
// Take the first 5 cues and give each a real end halfway to the next line.
const head = plain.cues.slice(0, 5);
const endsText = head.map((c, i) => {
  const nxt = i + 1 < head.length ? head[i + 1].time : c.time + 3;
  const end = c.time + (nxt - c.time) / 2;
  const f = (s) => {
    const m = Math.floor(s / 60);
    return m + ":" + (s - m * 60).toFixed(2).padStart(5, "0");
  };
  return f(c.time) + " | " + f(end) + " | " + c.text;
}).join("\n");

const withEnds = parseLrc(lrcText, endsText);
check(withEnds.hasEnds, "hasEnds reported");
const timedCount = withEnds.cues.filter((c) => c.endFrom === "timed").length;
check(timedCount === 5, timedCount + " cues use the timed end");
check(
  withEnds.cues[0].end < plain.cues[0].end,
  "the real end is earlier than the guess for cue 0 (" +
    withEnds.cues[0].end.toFixed(2) + " vs " + plain.cues[0].end.toFixed(2) + ")"
);
check(withEnds.cues[0].endFrom === "timed", "source recorded on the cue");

console.log("\n=== mismatched ends must fall back, not corrupt ===");
// An end that runs past the NEXT line is a stale file, not a real timing.
const stale = (() => {
  const c = plain.cues[0];
  const nxt = plain.cues[1].time;
  const f = (s) => {
    const m = Math.floor(s / 60);
    return m + ":" + (s - m * 60).toFixed(2).padStart(5, "0");
  };
  return f(c.time) + " | " + f(nxt + 30) + " | " + c.text;
})();
const withStale = parseLrc(lrcText, stale);
check(withStale.cues[0].endFrom === "estimated", "stale end rejected, guess used");
check(withStale.cues[0].end === plain.cues[0].end, "and the guess is the old value");

console.log("\n=== the real Allare ends file ===");
if (existsSync(ENDS)) {
  const real = parseLrc(lrcText, readFileSync(ENDS, "utf-8"));
  const t = real.cues.filter((c) => c.endFrom === "timed").length;
  console.log("  " + basename(ENDS) + ": " + t + " of " + real.cues.length + " cues timed");
  check(t > 0, "at least one real end applied");
} else {
  console.log("  (no " + basename(ENDS) + " yet — re-time a song in Song Timer to make one)");
}

console.log("\n=== artist tag ===");
const withBand = parseLrc("[ti:Ritu]\n[ar:Some Band]\n[00:10.00]one");
check(withBand.title === "Ritu", "title read");
check(withBand.band === "Some Band", "band read");

console.log(failures ? "\n" + failures + " FAILURES" : "\nall checks passed");
process.exit(failures ? 1 : 0);
