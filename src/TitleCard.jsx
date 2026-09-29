import React from "react";
import { titleCardWindow, outroCardWindow } from "./opener.js";

/**
 * The opening and closing title cards, modelled on the reference video.
 *
 * Measured from the reference: it opens on the song name with the band beneath
 * it, holds while the first lyric is still far away, and closes the file with a
 * smaller repeat of the same card. Both are here because they are the most
 * visible difference between a plain lyric video and that look.
 *
 * The window is DERIVED from the song's first and last timings (see opener.js)
 * rather than passed in, so re-timing a song cannot leave the card pointing at
 * a lyric that has moved.
 *
 * @param {object} o
 * @param {number} o.t          current time in seconds
 * @param {number} o.firstLyric
 * @param {number} o.lastLyricEnd
 * @param {string} [o.title]
 * @param {string} [o.band]
 * @param {string} [o.color]
 * @param {boolean} [o.anyway]  show even when the opener does not fit
 * @param {boolean} [o.outro]   include the closing card
 */
export function TitleCard({
  t,
  firstLyric,
  lastLyricEnd,
  title,
  band,
  color = "#ffffff",
  anyway = false,
  outro = true,
}) {
  if (!title && !band) return null;

  const open = titleCardWindow({ firstLyric, hasTitle: !!title, hasBand: !!band, force: anyway });
  const close = outro ? outroCardWindow({ lastLyricEnd }) : { enabled: false, from: 0, to: 0 };

  let phase = null;
  if (open.enabled && t >= open.from && t < open.to) phase = "open";
  else if (close.enabled && t >= close.from && t < close.to) phase = "close";
  if (!phase) return null;

  // The closing card is the quieter of the two: smaller, and no band, because
  // it is a bookend rather than an introduction.
  const big = phase === "open";
  const wrap = { open, close };
  const span = phase === "open" ? wrap.open : wrap.close;
  const elapsed = t - span.from;
  const total = span.to - span.from;

  // Fade in over the first fifth, out over the last fifth, with a flat middle.
  // Linear ramps read as a flicker; a held middle reads as deliberate.
  const FADE = 0.2;
  const p = elapsed / Math.max(0.001, total);
  const opacity =
    p < FADE ? p / FADE : p > 1 - FADE ? Math.max(0, (1 - p) / FADE) : 1;

  // A slow settle rather than a scale pop: the card should already feel
  // present, not animate itself into being.
  const settle = Math.min(1, elapsed / 0.8);
  const rise = (1 - settle) * 14;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: big ? "2.2vh" : "1.4vh",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          color,
          fontSize: big ? "7.4vh" : "5.4vh",
          fontWeight: 700,
          letterSpacing: ".01em",
          lineHeight: 1.15,
          textAlign: "center",
          padding: "0 6vw",
          textShadow: "0 2px 18px rgba(0,0,0,.8), 0 0 60px rgba(0,0,0,.5)",
          opacity,
          transform: `translateY(${rise}px)`,
        }}
      >
        {title}
      </div>
      {big && band ? (
        <div
          style={{
            color: "#c8d3de",
            // Spaced capitals, as in the reference's artist credit. Not
            // letter-spaced Nepali: the script has no case and extra tracking
            // breaks the conjuncts.
            fontFamily: big ? "inherit" : "inherit",
            fontSize: "2.5vh",
            fontWeight: 500,
            letterSpacing: band.trim() === band ? ".34em" : ".02em",
            textTransform: band.trim() === band ? "uppercase" : "none",
            textAlign: "center",
            padding: "0 6vw",
            textShadow: "0 2px 14px rgba(0,0,0,.8)",
            opacity: opacity * 0.92,
            transform: `translateY(${rise * 1.4}px)`,
          }}
        >
          {band}
        </div>
      ) : null}
    </div>
  );
}

export default TitleCard;
