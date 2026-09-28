// Parse an .lrc file (as exported by Song Timer) into timed cues.
//
// Handles the shapes Song Timer actually emits, plus the ones a hand-edited
// file tends to contain:
//   [ti:Title]                    metadata
//   [ar:Artist] [al:Album]        other metadata, ignored
//   [00:38.57]line                 one stamp
//   [00:38.57][01:12.30]line      same text at several times
//   [00:38]line                    no fraction
//   [SECTION]                      ignored (Song Timer filters these already,
//                                   but a pasted .txt may still contain them)
//
// Returns { title, cues } with cues sorted by time. Each cue carries
// { time, end, text, index } where `end` is the next cue's time.

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

export function parseLrc(text) {
  const cues = [];
  let title = "";

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const meta = line.match(META_RE);
    if (meta) {
      if (meta[1].toLowerCase() === "ti") title = meta[2].trim();
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

  cues.forEach((c, i) => {
    c.index = i;
    const next = i + 1 < cues.length ? cues[i + 1].time : c.time + TAIL_SECONDS;
    c.end = Math.max(c.time + 1, Math.min(Math.max(c.time, next), c.time + HOLD_SECONDS));
  });

  return { title, cues };
}

export default parseLrc;
