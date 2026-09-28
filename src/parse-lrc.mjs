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

const TIME_RE = /\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g;
const META_RE = /^\[(ti|ar|al|au|by|re|ve|length|offset):(.*)\]$/i;

/** Tail added after the final line so it does not vanish mid-view. */
const TAIL_SECONDS = 4;

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

    // Pull every leading timestamp, then whatever text is left.
    const stamps = [];
    let rest = line;
    let m;
    TIME_RE.lastIndex = 0;
    while ((m = TIME_RE.exec(rest))) {
      // Only timestamps at the head of the line count; a [bracketed] word
      // later in a lyric must not be read as a time.
      if (m.index !== 0) break;
      const fracRaw = m[3] || "0";
      const frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
      stamps.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac);
      rest = rest.slice(m[0].length);
    }
    if (!stamps.length) continue;

    const text2 = rest.trim();
    for (const time of stamps) cues.push({ time, text: text2 });
  }

  cues.sort((a, b) => a.time - b.time);

  cues.forEach((c, i) => {
    c.index = i;
    c.end = i + 1 < cues.length ? Math.max(c.time, cues[i + 1].time) : c.time + TAIL_SECONDS;
  });

  return { title, cues };
}

export default parseLrc;
