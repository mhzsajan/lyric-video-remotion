import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { styleFor, jitterFor } from "./animations.js";
import { AUDIO_FILE } from "./lyrics.generated.js";

const FONT_FAMILY =
  process.env.LYRIC_FONT ||
  '"Noto Sans Devanagari", "Nirmala UI", "Microsoft New Tai Lue", "Segoe UI", sans-serif';
const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const easeOut = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const easeIn = (t) => Math.pow(clamp01(t), 3);

const ENTER = 0.34; // seconds
const EXIT = 0.28;

/**
 * Compute the visual state of one cue at time t.
 * Exported so the still/contact-sheet renderer can reuse it without React.
 */
export function cueStyle(style, p, q, j) {
  // p = 0..1 through the entrance, q = 0..1 through the exit, j = 0..1 jitter
  const inE = easeOut(p);
  const outE = easeIn(q);
  const opacity = Math.min(inE, outE);
  const s = { opacity, transform: "", filter: "", clipPath: undefined };

  switch (style) {
    case "rise":
      s.transform = `translateY(${(1 - inE) * 44}px)`;
      break;
    case "pop":
      s.transform = `scale(${0.86 + 0.14 * inE})`;
      break;
    case "slide-left":
      s.transform = `translateX(${(1 - inE) * (90 + j * 50)}px)`;
      break;
    case "slide-right":
      s.transform = `translateX(${(1 - inE) * -(90 + j * 50)}px)`;
      break;
    case "zoom-through": {
      const z = 1.18 - 0.18 * inE;
      s.transform = `scale(${z})`;
      s.opacity = opacity * (0.65 + 0.35 * inE);
      break;
    }
    case "blur-in":
      s.filter = `blur(${(1 - inE) * (10 + j * 8)}px)`;
      s.transform = `scale(${0.97 + 0.03 * inE})`;
      break;
    case "typewriter": {
      // Wipe the text in by clipping from the left, with a slight ease so it
      // does not read as a hard mask.
      const w = 100 * inE;
      s.clipPath = `inset(0 ${(100 - w).toFixed(2)}% 0 0)`;
      break;
    }
    case "fade":
    default:
      break;
  }
  return s;
}

export const LyricOverlay = ({ cues, seed, style, fontSize, color, shadow, position, background }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  // Active cue = the last one that has started.
  let idx = -1;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].time <= t) idx = i;
    else break;
  }

  const align = {
    top: { justifyContent: "flex-start", paddingTop: "8vh" },
    center: { justifyContent: "center" },
    bottom: { justifyContent: "flex-end", paddingBottom: "9vh" },
  }[position || "center"];

  const frameStyle = {
    // "transparent" = alpha overlay (mov / ProRes 4444). A colour like
    // "#000000" = keyable plate for containers without alpha (mp4): the
    // consumer sets the layer blend to Add/Screen so black disappears.
    backgroundColor: background || "transparent",
    alignItems: "center",
    padding: "0 8vw",
    ...align,
  };

  if (idx < 0) return <AbsoluteFill style={frameStyle} />;

  const cue = cues[idx];
  const since = t - cue.time;
  const until = cue.end - t;
  const picked = styleFor(seed || "song", idx, style);
  const st = cueStyle(picked, since / ENTER, until / EXIT, jitterFor(seed || "song", idx));

  // The line just before, drifting away — reads as motion rather than a hard cut.
  const prev = idx > 0 ? cues[idx - 1] : null;
  const prevAge = prev ? t - prev.time : 0;
  const prevSpan = prev ? prev.end - prev.time : 0;
  const prevLife = prevSpan > 0 ? clamp01(prevAge / prevSpan) : 1;

  const textStyle = {
    fontFamily: FONT_FAMILY,
    fontWeight: 700,
    color,
    textShadow: shadow,
    fontSize,
    lineHeight: 1.32,
    textAlign: "center",
    whiteSpace: "pre-wrap",
    margin: 0,
  };

  return (
    <AbsoluteFill style={frameStyle}>
      {/* The song itself, so the finished .mov is self-contained: drop it on a
          Videosync2 layer and it syncs against its own audio with no external
          reference. */}
      {AUDIO_FILE ? <Audio src={staticFile(AUDIO_FILE)} /> : null}

      {prev && prevLife < 1 ? (
        <div
          style={{
            ...textStyle,
            position: "absolute",
            fontSize: fontSize * 0.62,
            opacity: (1 - prevLife) * 0.75,
            transform: `translateY(${-prevLife * 30}px)`,
          }}
        >
          {prev.text}
        </div>
      ) : null}

      <div style={{ ...textStyle, ...st }}>{cue.text}</div>
    </AbsoluteFill>
  );
};
