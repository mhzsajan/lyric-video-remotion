// Derive the opener timings so the title card can be shown on a real render.
//
// The reference video opens with the song name and the band, holds them, and
// only then starts the lyrics. Rather than hard-coding "4 seconds", this reads
// the song's own timings: the card has to appear before the first lyric, and
// the first lyric can be at 1:06 or at 0:04 depending on the song.
//
// Run for a song to see what the renderer will decide on its own.
//
// The card is placed AUTOMATICALLY -- see titleCardWindow() in
// src/opener.js. This script exists to show the decision and flag songs where
// it does not fit, not to hand over numbers to paste. Re-typing a window per
// song is exactly the drift that makes a show file stop matching the video.
import { readFileSync, existsSync } from "fs";
import { parseLrc } from "../src/parse-lrc.mjs";
import { titleCardWindow } from "../src/opener.js";

const LRC = process.argv[2];
if (!LRC) {
  console.log("usage: node scripts/check_timing.mjs <lrc> [ends.txt]");
  console.log("");
  console.log("Prints the opener timings for --title-card, worked out from the");
  console.log("song rather than guessed: the card has to fit before the first");
  console.log("line is sung.");
  process.exit(2);
}
const ENDS = process.argv[3] || LRC.replace(/\.lrc$/i, ".ends.txt");
const endsText = existsSync(ENDS) ? readFileSync(ENDS, "utf-8") : null;

const { cues, title, band } = parseLrc(readFileSync(LRC, "utf-8"), endsText);
if (!cues.length) {
  console.log("  no timed lines");
  process.exit(1);
}

const first = cues[0].time;
const timed = cues.filter((c) => c.endFrom === "timed").length;

console.log("  " + LRC);
console.log("");
console.log("  title : " + (title || "(none -- add a title in Song Timer)"));
console.log("  band  : " + (band || "(none -- optional)"));
console.log("  first lyric at : " + first.toFixed(2) + "s");
console.log("  ends           : " + timed + "/" + cues.length + " timed");
console.log("");

const win = titleCardWindow({ firstLyric: first, hasTitle: !!title, hasBand: !!band });
console.log("  title card : " + (win.enabled
  ? win.from.toFixed(2) + "s to " + win.to.toFixed(2) + "s (automatic)"
  : "skipped -- " + win.reason));
console.log("  render with: --title-card   (no numbers to pass; placement is derived)");
console.log("");

if (!win.enabled && win.reason === "no-room") {
  console.log("  NOTE: the first lyric is at " + first.toFixed(2) +
    "s, so there is not much room for a card before it.");
  console.log("  Pass --title-card-anyway to show it from 0s into the first line.");
}
if (!title) {
  console.log("  NOTE: without a title the card has nothing to show. Add one in");
  console.log("  Song Timer (the field above the lyrics) and re-export.");
}

if (!title) {
  console.log("  NOTE: without a title the renderer has nothing to show.");
}
