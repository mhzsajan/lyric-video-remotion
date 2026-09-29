// check_mix.mjs -- the mixed-mode plan, and the arithmetic that guarantees it
// covers everything.
//
// run:  node scripts/check_mix.mjs
//
// WHY THIS IS A SEPARATE MODULE AND A SEPARATE TEST
// -------------------------------------------------
// mix.js holds no React and no Remotion, so the whole plan can be checked in
// milliseconds without bundling or rendering a frame. That matters because the
// failure this guards against is not a crash -- it is a plan that quietly picks
// `horizontal` thirty times and never shows `vertical`, which looks like a
// working feature that does not do what it says.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  PRESENTATIONS,
  PRESENTATION_IDS,
  PLACEMENTS,
  UNITS,
  buildMixPlan,
  parsePlan,
  presentationFor,
  describePlan,
} from "../src/mix.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "..", "src", "mix.js"), "utf8");

let bad = 0;
const fail = (m) => {
  console.error("  FAIL " + m);
  bad++;
};
const pass = (m) => console.log("  ok   " + m);

console.log("");

// ---- 1. all eight presentations exist and are well formed ------------------
{
  const expected = PLACEMENTS.length * UNITS.length;
  if (PRESENTATIONS.length === expected) {
    pass(`all ${expected} placement x unit combinations are present`);
  } else {
    fail(
      `${PRESENTATIONS.length} presentations for ${expected} combinations; ` +
        "one of them can never be selected"
    );
  }
  let shapeOk = true;
  for (const p of PRESENTATIONS) {
    if (!PLACEMENTS.includes(p.place) || !UNITS.includes(p.unit)) shapeOk = false;
  }
  if (shapeOk) pass("every presentation names a real placement and unit");
  else fail("a presentation names a placement or unit that does not exist");

  // The user asked for vertical AND horizontal, word AND phrase. If any one of
  // those four is missing from the list, no plan can ever produce it.
  for (const place of ["horizontal", "vertical"]) {
    for (const unit of ["word", "phrase"]) {
      const has = PRESENTATIONS.some((p) => p.place === place && p.unit === unit);
      if (!has) fail(`no presentation combines ${place} with ${unit}`);
    }
  }
  pass("vertical and horizontal each have a word and a phrase variant");
}

// ---- 2. the deck alternates placements, including the wrap ----------------
//
// The wrap is the part that is easy to forget and the part that bites at the
// end of every eight blocks, which is the most visible place in a song to
// have a stutter. A deck that only alternates internally deals a collision
// exactly at the cycle seam.
{
  const places = PRESENTATIONS.map((p) => p.place);
  let badAt = -1;
  for (let i = 0; i < places.length; i++) {
    if (places[i] === places[(i + 1) % places.length]) badAt = i;
  }
  if (badAt < 0) {
    pass("no two neighbouring presentations share a placement, including last-to-first");
  } else {
    fail(
      `presentations ${badAt} and ${badAt + 1} (wrapping) are both ` +
        PRESENTATIONS[badAt].place + ", so every cycle seam stutters"
    );
  }
}

// ---- 3. a default plan over a real song covers everything ------------------
//
// Allare: 109 cues. This is the actual shape of the problem, not a synthetic
// count, because a plan that only works at 8 cues is not a plan.
{
  const plan = buildMixPlan({ seed: "Allare", cueCount: 109 });
  const seen = new Set(plan.map((p) => p.id));
  if (plan.length === 109) {
    pass("the plan has one entry per cue");
  } else {
    fail(`the plan has ${plan.length} entries for 109 cues`);
  }
  if (seen.size === PRESENTATIONS.length) {
    pass(`all ${seen.size} presentations appear in a 109-cue song`);
  } else {
    fail(
      `only ${seen.size} of ${PRESENTATIONS.length} presentations appear: ` +
        PRESENTATION_IDS.filter((id) => !seen.has(id)).join(", ")
    );
  }

  // Both units and all four placements must actually be used, or "word by
  // word, phrase by phrase, vertical, horizontal, all" is only half delivered.
  const units = new Set(plan.map((p) => p.unit));
  const places = new Set(plan.map((p) => p.place));
  if (units.size === 2) pass("both word and phrase are used");
  else fail(`only ${[...units].join(" and ")} are used`);
  if (places.size === 4) pass("all four placements are used");
  else fail(`only ${[...places].join(", ")} are used`);

  // No two adjacent BLOCKS in the same placement. Cues inside one block share a
  // presentation by design, so the check has to be at block boundaries --
  // checking each cue against the previous one is not a stricter test, it is a
  // different and wrong one, and it fires on every cue after the first.
  const blockIds = [];
  for (const p of plan) {
    if (!blockIds.length || blockIds[blockIds.length - 1].id !== p.id) {
      blockIds.push({ id: p.id, place: p.place });
    }
  }
  let stutters = 0;
  for (let i = 1; i < blockIds.length; i++) {
    if (blockIds[i].place === blockIds[i - 1].place) stutters++;
  }
  if (stutters === 0) {
    pass(`no two of the ${blockIds.length} blocks repeat a placement, across every cycle seam`);
  } else {
    fail(`${stutters} adjacent blocks repeat a placement, which reads as a stutter`);
  }
  // 109 / 8 = 14 blocks, dealt from a deck of 8, so the first 8 BLOCKS must be
  // all eight presentations exactly once. That is the coverage guarantee, and
  // it is worth stating as its own check because an earlier strided-walk
  // version satisfied "all eight appear somewhere" while a local nudge left
  // two of them unreachable for the whole song.
  if (blockIds.length === Math.ceil(109 / 8)) {
    pass(`109 cues at block:8 give ${blockIds.length} blocks`);
  } else {
    fail(`109 cues at block:8 gave ${blockIds.length} blocks, not ${Math.ceil(109 / 8)}`);
  }
  const firstCycle = new Set(blockIds.slice(0, 8).map((b) => b.id));
  if (firstCycle.size === PRESENTATIONS.length) {
    pass("the first eight BLOCKS use all eight presentations exactly once");
  } else {
    fail(
      `the first eight blocks only used ${firstCycle.size} presentations: ` +
        PRESENTATION_IDS.filter((id) => !firstCycle.has(id)).join(", ")
    );
  }
}

// ---- 4. it is deterministic, and varies by seed ---------------------------
{
  const a = buildMixPlan({ seed: "Allare", cueCount: 109 });
  const b = buildMixPlan({ seed: "Allare", cueCount: 109 });
  if (JSON.stringify(a) === JSON.stringify(b)) {
    pass("the same seed gives the same plan, every time");
  } else {
    fail("the same seed gave two different plans; the show file would stop matching");
  }
  const c = buildMixPlan({ seed: "Kali Kali", cueCount: 109 });
  if (JSON.stringify(a) !== JSON.stringify(c)) {
    pass("a different song gives a different plan");
  } else {
    fail("two different songs got the same plan, so the offset is not seeded");
  }
}

// ---- 5. block size ---------------------------------------------------------
{
  // block:1 is clamped up to the readable minimum. At Allare's median 1.4s a
  // cue, one presentation per cue is not variety, it is a flicker the eye
  // never resolves. So the floor is 4, and 40 cues must land on 10 blocks.
  const one = buildMixPlan({ seed: "s", cueCount: 40, block: 1 });
  const blocks = new Set(one.map((p) => p.block)).size;
  if (blocks === 10) {
    pass("block:1 is clamped to 4 cues, giving 10 blocks over 40 cues");
  } else {
    fail(`block:1 gave ${blocks} blocks over 40 cues; it must clamp to 4 cues per block`);
  }
  // block:0 is falsy, so it takes the default of 8 rather than clamping to the
  // floor of 4. 40 cues at 8 per block is 5 blocks.
  const zero = buildMixPlan({ seed: "s", cueCount: 40, block: 0 });
  if (new Set(zero.map((p) => p.block)).size === 5) {
    pass("block:0 takes the default of 8 rather than dividing by nothing");
  } else {
    fail(`block:0 gave ${new Set(zero.map((p) => p.block)).size} blocks, not 5`);
  }
  const eight = buildMixPlan({ seed: "s", cueCount: 109, block: 8 });
  if (new Set(eight.map((p) => p.block)).size === Math.ceil(109 / 8)) {
    pass("block:8 gives 14 blocks over 109 cues");
  } else {
    fail("block:8 did not give 14 blocks over 109 cues");
  }
}

// ---- 6. an explicit plan, and its error handling --------------------------
{
  const p = parsePlan("0-3:h-word,4-5:v-phrase,6+:*", 8);
  if (p.length === 8) {
    pass("an explicit plan covers the whole song");
  } else {
    fail(`an explicit plan returned ${p.length} entries for 8 cues`);
  }
  // 0-3 pinned, then the walk takes over from 6.
  if (p.slice(0, 4).every((x) => x.id === "h-word")) {
    pass("an explicit range is honoured for every cue it names");
  } else {
    fail(`an explicit range was not honoured: ${p.map((x) => x.id).join(",")}`);
  }
  if (p[4].place === "vertical") {
    pass("a second range switches placement");
  } else {
    fail(`the second range did not take: cue 5 is ${p[4].id}`);
  }
  if (p.slice(6).every((x) => x)) {
    pass("cues the spec did not name fall back to the walk, not to a hole");
  } else {
    fail("a cue the spec did not name is empty");
  }

  // "N+" has no dash. It is the form the docstring uses as its own example, so
  // if the parser rejects it the documentation is describing a syntax that does
  // not exist -- which is how a plan silently fails to apply.
  try {
    const plus = parsePlan("0+:*", 5);
    if (plus.length === 5) pass('the "N+" open-ended form parses');
    else fail('the "N+" form returned the wrong length');
  } catch (e) {
    fail('the "N+" open-ended form is rejected: ' + e.message);
  }
  try {
    const both = parsePlan("0-1:h-word,2+:*", 5);
    if (both[0].id === "h-word" && both[4]) pass('"0-1" and "2+" combine in one plan');
    else fail('"0-1" and "2+" did not combine');
  } catch (e) {
    fail('"0-1" and "2+" do not combine: ' + e.message);
  }

  let threw = false;
  try {
    presentationFor("nope");
  } catch {
    threw = true;
  }
  if (threw) pass("an unknown presentation id is an error, not a silent default");
  else fail("an unknown presentation id fell back to a default");

  for (const bad of ["garbage", "0-7", "a-b:h-word", "0-7:nope"]) {
    let t = false;
    try {
      parsePlan(bad, 8);
    } catch {
      t = true;
    }
    if (!t) fail(`a malformed --mix-plan chunk was ignored: ${JSON.stringify(bad)}`);
  }
  pass("every malformed --mix-plan chunk is an error, not silence");
}

// ---- 7. describePlan, because a mixed video is unreproducible by eye ------
//
// "It looked wrong at 2:40" is not a bug report you can act on unless the log
// says what was on screen at 2:40. This is the only record of the plan.
{
  const plan = buildMixPlan({ seed: "Allare", cueCount: 24, block: 4 });
  const lines = describePlan(plan);
  if (lines.length === 6 && /^cues? \d+-\d+\s+\S+$/.test(lines[0].trim())) {
    pass(`24 cues at block:4 print as ${lines.length} ranges, e.g. "${lines[0].trim()}"`);
  } else {
    fail(`describePlan produced ${lines.length} lines, first: ${JSON.stringify(lines[0])}`);
  }
  // Every cue has to appear in exactly one range, or the log is a lie.
  let covered = 0;
  for (const l of lines) {
    const m = /cues? (\d+)-(\d+)/.exec(l);
    if (m) covered += Number(m[2]) - Number(m[1]) + 1;
  }
  if (covered === 24) {
    pass("the ranges account for all 24 cues exactly once");
  } else {
    fail(`the ranges account for ${covered} cues, not 24`);
  }
}

console.log("");
if (bad) {
  console.log("  " + bad + " problem(s).");
  process.exit(1);
}
console.log("  the mixed plan covers every presentation and is reproducible.");
