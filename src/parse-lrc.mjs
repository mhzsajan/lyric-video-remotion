// Parse an .lrc file (as exported by Song Timer) into timed cues.
//
// Handles the shapes Song Timer actually emits, plus the ones a hand-edited
// file tends to contain:
//   [ti:Title]                    title
//   [ar:Artist] [al:Album]        artist is kept (the renderer shows it on a
//                                  title card); other metadata ignored
//   [00:38.57]line                 one stamp
//   [00:38.57][01:12.30]line      same text at several times
//   [00:38]line                    no fraction
//   [SECTION]                      ignored (Song Timer filters these already,
//                                   but a pasted .txt may still contain them)
//
// Returns { title, band, cues } with cues sorted by time. Each cue carries
// { time, end, text, index, endFrom }.
//
// WHERE `end` COMES FROM
// ----------------------
// A .lrc only records when a line BEGINS. Without more, the end is guessed: the
// next line's start, capped at HOLD_SECONDS. That guess is wrong exactly where
// it shows -- a line sung before a long instrumental was measured lingering a
// median of 10s in Allare and 22s in Kali Kali, up to 70s -- which reads as a
// freeze-frame rather than a lyric video.
//
// So when an ends companion exists (Song Timer's "For Remotion AI" export,
// <song>.remotion_end.lrc), the real end is used. `endFrom` records which, so
// the cue report and the preflight check can say where a given end came from
// instead of guessing.

import { parseEnds } from "./parse-ends.mjs";

const TIME_RE = /^(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?/;
const META_RE = /^\[(ti|ar|al|au|by|re|ve|length|offset):(.*)\]$/i;

/** Tail added after the final line so it does not vanish mid-view. */
const TAIL_SECONDS = 4;

/**
 * A line never stays on screen longer than this, even if the next stamp is
 * minutes away: hand-timed .lrc files leave the screen unstamped through
 * instrumental breaks, and holding the last sung line there for 40-60s reads
 * as a freeze-frame rather than a lyric video.
 */
const HOLD_SECONDS = 8;

const key = (t) => Math.round(t * 100);

export function parseLrc(text, endsText) {
  const cues = [];
  let title = "";
  let band = "";

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const meta = line.match(META_RE);
    if (meta) {
      // `tag`, not `key` -- key() is the centisecond lookup used further down.
      const tag = meta[1].toLowerCase();
      if (tag === "ti") title = meta[2].trim();
      else if (tag === "ar") band = meta[2].trim();
      continue;
    }

    // Pull every leading timestamp, then whatever text is left. Each stamp is
    // matched by slicing off the leading "[" first, so TIME_RE stays anchored:
    // a global exec loop keeps lastIndex in the ORIGINAL string's coordinates,
    // and after the first slice it silently skips stamps -- leaving repeats of
    // a chorus glued to their remaining [times] as visible on-screen garbage.
    const stamps = [];
    let rest = line;
    let m;
    while (rest.startsWith("[") && (m = rest.slice(1).match(TIME_RE))) {
      const fracRaw = m[3] || "0";
      const frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
      stamps.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac);
      // Consume the stamp AND its closing bracket: stopping at "]" leaves it
      // in front of the next "[", so the loop would see no leading bracket
      // and quit after the first stamp of each line.
      rest = rest.slice(2 + m[0].length);
    }
    rest = rest.trim();
    if (!stamps.length) continue;

    const text2 = rest.trim();
    for (const time of stamps) cues.push({ time, text: text2 });
  }

  cues.sort((a, b) => a.time - b.time);

  // A real end beats a guessed one. Matching is on the start time to the
  // centisecond, because a repeated chorus legitimately appears several times in
  // the .lrc as several stamps of ONE line, and each occurrence has its own end.
  const ends = endsText ? parseEnds(endsText).ends : new Map();

  cues.forEach((c, i) => {
    c.index = i;
    const next = i + 1 < cues.length ? cues[i + 1].time : c.time + TAIL_SECONDS;
    const guess = Math.max(
      c.time + 1,
      Math.min(Math.max(c.time, next), c.time + HOLD_SECONDS)
    );

    const found = ends.get(key(c.time));
    const nextTime = i + 1 < cues.length ? cues[i + 1].time : null;

    if (found && found.end > c.time) {
      // A real end that runs a fraction past the next line's start is NORMAL:
      // it is the tail of the last syllable, and Song Timer stamps the line
      // as finished a beat after the next one begins. It used to be
      // discarded, which threw away a tapped timing for a 30 ms overshoot
      // and fell back to an estimate -- the exact lingering-lyric problem the
      // ends file exists to solve. On Allare that silently cost 10 of 109
      // cues their real end.
      //
      // Clamp instead. The line still clears exactly when the next one
      // appears, which is the correct visual either way, and the tapped data
      // is kept.
      if (nextTime !== null && found.end > nextTime) {
        c.end = nextTime;
        c.endFrom = "timed-clamped";
      } else {
        c.end = found.end;
        c.endFrom = "timed";
      }
      return;
    }

    c.end = guess;
    c.endFrom = "estimated";
  });

  return { title, band, cues, hasEnds: ends.size > 0 };
}

export default parseLrc;
