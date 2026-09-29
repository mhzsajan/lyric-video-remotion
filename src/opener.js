// Decide when the opening title card appears, from the song's own timings.
//
// WHY DERIVED, NOT PASSED
// -----------------------
// A hand-set window per song is exactly the drift that makes a show file stop
// matching the video: retype a first line, forget to update the card, and the
// two disagree. The first lyric's position is the only fact needed, and it is
// already in the .lrc, so the card is placed from it every time.
//
// The reference video's behaviour, measured: a title card holds at the start
// while the first lyric is still 25+ seconds away, and a small card closes the
// file. Both are reproduced here -- the opener and the outro -- because they are
// the clearest thing separating the reference look from a plain lyric video.

/** How long the closing card shows after the last lyric ends. */
export const TAIL_SECONDS = 4;

/** The title card needs this long to be readable, minimum. */
const MIN_CARD = 1.5;

/**
 * Work out the opener window.
 *
 * @param {object} o
 * @param {number} o.firstLyric  when the first line is sung, in seconds
 * @param {boolean} [o.hasTitle]
 * @param {boolean} [o.hasBand]
 * @param {boolean} [o.force]    show it even when it does not fit
 * @param {number} [o.lead]      silence before the card, default 0.6s
 * @returns {{enabled: boolean, from: number, to: number, reason: string}}
 */
export function titleCardWindow({ firstLyric, hasTitle, hasBand, force, lead = 0.6 }) {
  if (!hasTitle && !hasBand) {
    return { enabled: false, from: 0, to: 0, reason: "no title or band to show" };
  }
  if (!Number.isFinite(firstLyric)) {
    return { enabled: false, from: 0, to: 0, reason: "no first lyric" };
  }

  const from = Math.max(0, lead);
  // Up to 6s is plenty to read a title and a band name, and stopping short of
  // the first line keeps the card from sitting under the opening lyric.
  const wanted = 6;
  const to = Math.min(from + wanted, firstLyric - 0.2);

  if (to - from < MIN_CARD) {
    if (!force) {
      return {
        enabled: false,
        from: 0,
        to: 0,
        reason: "no-room",
      };
    }
    return { enabled: true, from, to: Math.max(from + MIN_CARD, to), reason: "forced" };
  }
  return { enabled: true, from, to, reason: "" };
}

/**
 * The closing card. The reference shows the title again at the end of the file.
 * @param {object} o
 * @param {number} o.lastLyricEnd
 * @param {number} [o.tail]  seconds to hold
 */
export function outroCardWindow({ lastLyricEnd, tail = TAIL_SECONDS }) {
  if (!Number.isFinite(lastLyricEnd) || tail <= 0) {
    return { enabled: false, from: 0, to: 0 };
  }
  return {
    enabled: true,
    from: lastLyricEnd + 0.4,
    to: lastLyricEnd + 0.4 + tail,
  };
}
