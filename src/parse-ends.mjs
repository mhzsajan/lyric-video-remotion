// Read the companion <title>.remotion_end.lrc that Song Timer writes alongside
// <title>.remotion_start.lrc.
//
// WHY A SEPARATE FILE
// -------------------
// End times cannot live in the .lrc. AbleSet turns every [timestamp] into a
// MIDI clip, so a second stamp meaning "end" would show the same lyric twice in
// Ableton -- and it would be indistinguishable from the existing convention
// where several stamps mean the same line repeated. Song Timer therefore writes
// the start file for AbleSet and this file for the renderer. The format is the
// same pipe-separated table either way; only the name changed, so a folder
// exported before the rename still parses. See docs/ in songtimer, and AGENTS.md.
//
// FORMAT
// ------
//   # comment lines are ignored
//   start | end | text
//   1:06.45 | 1:07.10 | फर्केर आउने छैन
//
// Times are m:ss.ss. The text is the last field, so a lyric containing a pipe
// still parses -- the split is limited.
//
// MATCHING, AND WHY IT IS DELICATE
// --------------------------------
// A line is identified by its start time, because the .lrc may merge a
// repeated chorus into one entry with several stamps -- the same text can
// legitimately appear at four different times, and each needs its own end.
// Text alone would be ambiguous; time alone is exact to the hundredth of a
// second, which is what Song Timer writes. A tolerant match is still used for
// the text check, because a lyric may have been re-typed since the ends were
// recorded and that should not throw the timings away.

// NO "fs" IMPORT HERE, deliberately.
//
// parse-lrc.mjs imports this file, and parse-lrc.mjs is imported by the React
// component, so webpack bundles this into the browser bundle. A node builtin
// import fails the render with "Can't resolve 'fs' in src" -- the browser has
// no filesystem. Reading the file is therefore render.mjs's job, and it passes
// the text in. Keep this module pure: strings in, objects out.

const TIME = /^\s*(\d{1,3}):([0-5]?\d)(?:\.(\d{1,3}))?\s*$/;

/** "1:06.45" -> 66.45. Returns null if it is not a timestamp. */
export function parseClock(s) {
  const m = String(s).trim().match(TIME);
  if (!m) return null;
  const fracRaw = m[3] || "0";
  return (
    parseInt(m[1], 10) * 60 +
    parseInt(m[2], 10) +
    parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length)
  );
}

/** Round to centiseconds, the precision Song Timer writes. */
const key = (t) => Math.round(t * 100);

/**
 * Parse ends text into a Map keyed by centisecond start time.
 * @returns {{ends: Map<number,{end:number,text:string}>, problems: string[]}}
 */
export function parseEnds(text) {
  const ends = new Map();
  const problems = [];

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    // Split on the first two pipes only; the lyric keeps any others.
    const first = line.indexOf("|");
    const second = first >= 0 ? line.indexOf("|", first + 1) : -1;
    if (first < 0 || second < 0) {
      problems.push("no two pipes: " + JSON.stringify(line.slice(0, 60)));
      continue;
    }

    const start = parseClock(line.slice(0, first));
    const end = parseClock(line.slice(first + 1, second));
    const lyric = line.slice(second + 1).trim();

    if (start == null || end == null) {
      problems.push("unreadable time: " + JSON.stringify(line.slice(0, 60)));
      continue;
    }
    if (end <= start) {
      problems.push("end not after start at " + line.slice(0, first).trim());
      continue;
    }
    if (ends.has(key(start))) {
      problems.push("duplicate start " + line.slice(0, first).trim());
    }
    ends.set(key(start), { end, text: lyric });
  }

  return { ends, problems };
}

/**
 * Report what an ends file would contribute, without reading it. Kept here so
 * the caller can decide whether to bother.
 * @param {string|null} text
 * @returns {{ends: Map, problems: string[], loaded: boolean}}
 */
export function endsFromText(text) {
  if (text == null) return { ends: new Map(), problems: [], loaded: false };
  const { ends, problems } = parseEnds(text);
  return { ends, problems, loaded: true };
}
