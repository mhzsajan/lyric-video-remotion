// What the ends file actually buys, measured on a real song.
//
// The claim under test is that lines stop hanging on screen after the vocal has
// finished. That is measurable without rendering anything: for each cue, how
// much of the gap before the next line is spent with no text on screen.
import { readFileSync } from "fs";
import { parseLrc } from "../src/parse-lrc.mjs";

const LRC = process.argv[2] ||
  "D:\\DB Project\\Text Only Lyric Video Final\\Final\\Allare\\Allare Timmed.lrc";
const ENDS = process.argv[3] || LRC.replace(/\.lrc$/i, ".ends.txt");

const lrc = readFileSync(LRC, "utf-8");
let ends = null;
try {
  ends = readFileSync(ENDS, "utf-8");
} catch (e) {
  console.log("  (no ends file at " + ENDS + ")");
}

function measure(label, endsText) {
  const { cues } = parseLrc(lrc, endsText);
  const timed = cues.filter((c) => c.endFrom === "timed").length;

  // How long is each line visible? That is the number the audience feels: a
  // 30s hold reads as a freeze-frame, a 2s hold reads as a lyric.
  const holds = cues
    .map((c) => c.end - c.time)
    .sort((a, b) => a - b);
  const longest = holds[holds.length - 1];

  // And how much silence is left before the next line arrives.
  const gaps = [];
  cues.forEach((c, i) => {
    if (i + 1 < cues.length) gaps.push(cues[i + 1].time - c.end);
  });
  gaps.sort((a, b) => a - b);
  const gapMedian = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;

  console.log(
    "  " + label.padEnd(14) +
    String(timed).padStart(3) + "/" + cues.length + " timed | " +
    "line on screen: median " + holds[Math.floor(holds.length / 2)].toFixed(2) +
    "s, longest " + longest.toFixed(2) + "s | " +
    "silence before next: median " + gapMedian.toFixed(2) + "s"
  );
  return { timed, longest, holdMedian: holds[Math.floor(holds.length / 2)] };
}

console.log("  " + LRC.split("\\").pop() + "\n");
const before = measure("estimated", null);
const after = measure("timed", ends);

if (ends) {
  console.log("");
  console.log("  longest line on screen: " + before.longest.toFixed(2) + "s -> " +
    after.longest.toFixed(2) + "s");
  console.log("  median line on screen: " + before.holdMedian.toFixed(2) + "s -> " +
    after.holdMedian.toFixed(2) + "s");
}
