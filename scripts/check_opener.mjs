// The opener/timing decisions, asserted rather than eyeballed.
//
// These windows decide what appears on screen for the first and last few
// seconds of every video, which is the part a viewer notices first. Getting one
// wrong means a title card sitting on top of the first lyric, or a video that
// ends on a frozen frame.
import { titleCardWindow, outroCardWindow, TAIL_SECONDS } from "../src/opener.js";

let failures = 0;
const check = (cond, msg) => {
  console.log((cond ? "  ok   " : "  FAIL ") + msg);
  if (!cond) failures++;
};

console.log("=== titleCardWindow ===");

const roomy = titleCardWindow({ firstLyric: 97.88, hasTitle: true });
check(roomy.enabled, "enabled when the first lyric is far away");
check(roomy.from >= 0, "starts at or after zero");
check(roomy.to < 97.88, "closes before the first lyric (" + roomy.to.toFixed(2) + " < 97.88)");
check(roomy.to - roomy.from <= 6.01, "not held longer than 6s");

const tight = titleCardWindow({ firstLyric: 0.4, hasTitle: true });
check(!tight.enabled && tight.reason === "no-room", "skipped when there is no room");

const forced = titleCardWindow({ firstLyric: 0.4, hasTitle: true, force: true });
check(forced.enabled, "force overrides the no-room case");

const nothing = titleCardWindow({ firstLyric: 90, hasTitle: false, hasBand: false });
check(!nothing.enabled, "skipped with neither title nor band");
check(/no title/.test(nothing.reason), "and says why (" + nothing.reason + ")");

const bandOnly = titleCardWindow({ firstLyric: 90, hasBand: true });
check(bandOnly.enabled, "a band name alone is enough to show a card");

const early = titleCardWindow({ firstLyric: 3.0, hasTitle: true });
check(early.enabled && early.to <= 3.0, "fits when the first lyric is at 3s");
check(early.to < 3.0, "still leaves a gap before the lyric");

// A song starting at 0 must never produce an inverted window.
const zeroStart = titleCardWindow({ firstLyric: 0, hasTitle: true });
check(!zeroStart.enabled || zeroStart.to > zeroStart.from, "never inverted when the song starts at 0");

const noFirst = titleCardWindow({ firstLyric: NaN, hasTitle: true });
check(!noFirst.enabled, "skipped when there is no first lyric");

console.log("\n=== outroCardWindow ===");
const out = outroCardWindow({ lastLyricEnd: 415.36 });
check(out.enabled, "enabled after a real last lyric");
check(out.from > 415.36, "starts after the last lyric ends");
check(Math.abs(out.to - out.from - TAIL_SECONDS) < 1e-9, "holds for the tail length");

const noOut = outroCardWindow({ lastLyricEnd: NaN });
check(!noOut.enabled, "skipped when there is no last lyric");

const zeroTail = outroCardWindow({ lastLyricEnd: 100, tail: 0 });
check(!zeroTail.enabled, "skipped when the tail is zero");

console.log(failures ? "\n" + failures + " FAILURES" : "\nall checks passed");
process.exit(failures ? 1 : 0);
