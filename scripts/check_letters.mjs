// Verify grapheme splitting and letter sizing on real lyric text.
//
// The failure this guards against is silent and ugly: a conjunct like "क्ष"
// broken into pieces renders as a mangled glyph, and it would only be visible
// in the finished video. So assert the round-trip and the clamp here.
import { readFileSync } from "fs";
import { splitGraphemes, letterSizePct, LETTER_SIZE_CAP } from "../src/letters.js";

const LRC = process.argv[2] || "D:\\DB Project\\Text Only Lyric Video Final\\Final\\Allare\\Allare Timmed.lrc";

let fails = 0;
const check = (cond, msg) => {
  if (!cond) {
    fails++;
    console.log("  FAIL " + msg);
  }
};

// Known cases, straight from the renderer's own lyrics.
const CASES = [
  ["क्ष", 1, "conjunct क्ष must stay whole"],
  ["त्र", 1, "conjunct त्र must stay whole"],
  ["नि", 1, "pre-base matra नि must stay whole"],
  ["हावा", 2, "हावा is two aksaras"],
  ["सँगै", 2, "सँगै is two aksaras"],
  ["आउँछु", 3, "आउँछु is three aksaras"],
];
console.log("=== known cases ===");
for (const [text, expect, why] of CASES) {
  const got = splitGraphemes(text);
  const ok = got.length === expect && got.join("") === text;
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${text} -> ${got.length} ${JSON.stringify(got)}  (${why})`
  );
  check(ok, `${text}: got ${got.length}, want ${expect}`);
  check(got.join("") === text, `${text}: round-trip changed the text`);
}

// Every cue in a real song: round-trip must be lossless and no word may
// collapse to zero letters.
const ts = /\[(\d{2}):(\d{2})\.(\d{2})\]/g;
const texts = new Set();
for (const line of readFileSync(LRC, "utf8").split(/\r?\n/)) {
  const t = line.replace(ts, "").trim();
  if (t) texts.add(t);
}
console.log(`\n=== ${texts.size} distinct cue texts from the .lrc ===`);
let graphemes = 0;
let conjunctsKept = 0;
for (const text of texts) {
  for (const word of text.split(/\s+/)) {
    const g = splitGraphemes(word);
    graphemes += g.length;
    if (g.join("") !== word) {
      check(false, `round-trip broke: ${word}`);
    }
    if (g.length === 0) check(false, `empty word from: ${word}`);
    if (g.length < Array.from(word).length) conjunctsKept++;
  }
}
console.log(`  ${graphemes} graphemes across all words`);
console.log(`  ${conjunctsKept} words where graphemes < codepoints (conjuncts kept whole)`);
check(graphemes > 0, "no graphemes produced");

// The clamp: letter size must never exceed LETTER_SIZE_CAP, and must be a
// usable percentage rather than NaN/undefined.
console.log("\n=== size clamp ===");
const samples = [];
for (let i = 0; i < 40; i++) {
  const pct = letterSizePct(0.45, "Allare", 3, i); // ask for more than allowed
  const v = parseFloat(pct);
  samples.push(v);
  check(Number.isFinite(v), `letterSizePct returned ${pct}`);
  const dev = Math.abs(v - 100) / 100;
  check(dev <= LETTER_SIZE_CAP + 1e-6, `deviation ${dev} exceeds cap ${LETTER_SIZE_CAP}`);
}
const lo = Math.min(...samples);
const hi = Math.max(...samples);
console.log(`  asked 0.45, got ${lo.toFixed(1)}%..${hi.toFixed(1)}% (cap ${LETTER_SIZE_CAP})`);
console.log(`  effective range: ${((100 - lo) / 100).toFixed(3)}..${((100 + hi - 100) / 100 + 1).toFixed(3)}`);
check(hi - lo > 0, "all letters identical -- variation is not happening");

// amount 0 must disable it entirely.
const off = letterSizePct(0, "Allare", 3, 1);
check(off === null, `amount 0 should return null, got ${off}`);
console.log(`  amount 0 -> ${off} (disabled)`);

console.log(fails ? `\n${fails} FAILURES` : "\nall checks passed");
process.exit(fails ? 1 : 0);
