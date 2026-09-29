// Check derived word timings against the real cues of a real song.
//
// This is the part most likely to be subtly wrong -- a monotonicity bug or an
// off-by-one would show up as words popping out of order mid-render, which is
// expensive to spot by eye in a 4-minute video. So assert it here.
import { readFileSync } from "fs";
import { splitWords, wordWeight, wordTimings } from "../src/word-timing.js";

const LRC = process.argv[2] || "D:\\DB Project\\Text Only Lyric Video Final\\Final\\Allare\\Allare Timmed.lrc";
const HOLD = 8.0; // must match HOLD_SECONDS in render.mjs

const ts = /\[(\d{2}):(\d{2})\.(\d{2})\]/g;
const cues = [];
for (const line of readFileSync(LRC, "utf8").split(/\r?\n/)) {
  const stamps = [...line.matchAll(ts)];
  if (!stamps.length) continue;
  const text = line.replace(ts, "").trim();
  if (!text) continue;
  for (const m of stamps) {
    const t = +m[1] * 60 + +m[2] + +m[3] / 100;
    cues.push({ time: t, text });
  }
}
cues.sort((a, b) => a.time - b.time);
// Mirror the renderer's hold cap so the test sees the same spans.
for (let i = 0; i < cues.length; i++) {
  const next = cues[i + 1];
  cues[i].end = Math.min(next ? next.time : cues[i].time + HOLD,
                         cues[i].time + HOLD);
}

let fails = 0;
const check = (cond, msg) => {
  if (!cond) { fails++; console.log("  FAIL " + msg); }
};

console.log(`cues: ${cues.length}   from ${LRC.split("\\").pop()}\n`);

for (const cue of cues) {
  const words = wordTimings(cue);
  const textWords = splitWords(cue.text);

  check(words.length === textWords.length, `${cue.time}: word count mismatch`);
  check(words.map((w) => w.text).join(" ") === cue.text.trim(),
        `${cue.time}: reassembly changed the text`);

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    check(Number.isFinite(w.start) && Number.isFinite(w.end),
          `${cue.time} w${i}: non-finite time`);
    check(w.start >= cue.time - 1e-9, `${cue.time} w${i}: starts before cue`);
    check(w.end <= cue.end + 1e-9, `${cue.time} w${i}: ends after cue`);
    check(w.end >= w.start, `${cue.time} w${i}: negative duration`);
    if (i) {
      check(w.start >= words[i - 1].start - 1e-9,
            `${cue.time} w${i}: out of order`);
    }
  }
}

// Anchors must not be able to break monotonicity either.
const cue = cues.find((c) => splitWords(c.text).length >= 4);
if (cue) {
  const n = splitWords(cue.text).length;
  const scrambled = Array.from({ length: n }, (_, i) => cue.time + (n - i) * 0.1);
  const snapped = wordTimings(cue, { anchors: scrambled });
  let mono = true;
  for (let i = 1; i < snapped.length; i++) {
    if (snapped[i].start < snapped[i - 1].start) mono = false;
  }
  check(mono, "anchors broke monotonicity");
  check(snapped.every((w, i) => !Number.isFinite(scrambled[i]) ||
                              w.start === Math.max(snapped[i - 1]?.start ?? -1e9, scrambled[i])),
        "anchor not applied or not clamped forward");
  console.log(`anchor test: ${n} words, out-of-order anchors -> monotonic ${mono}`);
}

// Punctuation must not carry weight.
const w1 = wordWeight("नगर,");
const w2 = wordWeight("नगर");
check(w1 === w2, `punctuation changed weight: ${w1} vs ${w2}`);

// Show one real line, so the numbers can be eyeballed.
const sample = cues.find((c) => splitWords(c.text).length >= 4) || cues[0];
console.log(`\nsample cue  ${sample.time.toFixed(2)}s -> ${sample.end.toFixed(2)}s`);
console.log(`  ${JSON.stringify(sample.text)}`);
for (const w of wordTimings(sample)) {
  console.log(`  ${w.start.toFixed(2)}s -> ${w.end.toFixed(2)}s  ` +
              `(${(w.end - w.start).toFixed(2)}s, ${w.weight}) ${w.text}`);
}

console.log(fails ? `\n${fails} FAILURES` : "\nall checks passed");
process.exit(fails ? 1 : 0);
