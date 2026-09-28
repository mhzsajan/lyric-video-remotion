import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig, delayRender, continueRender } from "remotion";
import { styleFor, jitterFor, positionFor, sizeFor } from "./animations.js";
import { AUDIO_FILE, LEGACY_FONT_FILE, LEGACY_FONT_FAMILY } from "./lyrics.generated.js";

// Legacy Preeti-era fonts (AMS/Ananda/Abhinav): load the actual .ttf through
// the FontFace API -- a bare CSS font-family cannot name these fonts reliably
// across Chromium sandbox profiles, but explicit bytes always register. The
// FILE is copied into public/fonts by render.mjs; text arrives pre-converted
// to Preeti key sequences (scripts/lrc_legacy.py), which these fonts map to
// their real Devanagari glyphs.
if (LEGACY_FONT_FILE) {
  const handle = delayRender(`legacy font: ${LEGACY_FONT_FAMILY}`);
  const face = new FontFace(
    LEGACY_FONT_FAMILY,
    `url('${staticFile("fonts/" + LEGACY_FONT_FILE)}') format('truetype')`,
    { weight: "400" }
  );
  face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded);
      continueRender(handle);
    })
    .catch((err) => {
      console.error(`Legacy font failed: ${LEGACY_FONT_FAMILY}`, err);
      continueRender(handle);
    });
}

const FONT_FAMILY =
  LEGACY_FONT_FAMILY ||
  process.env.LYRIC_FONT ||
  '"Noto Sans Devanagari", "Nirmala UI", "Microsoft New Tai Lue", "Segoe UI", sans-serif';

// Legacy Preeti text is visual-order ASCII: applying fontWeight 700 makes
// Chromium synthesize fake bold (double-draw smear), and letter-spacing
// breaks the pre-base matra positioning that lives in the glyph order.
const legacyTextStyle = LEGACY_FONT_FAMILY ? { fontWeight: 400 } : {};

// -- random font size (--size-mode phrase|word) -----------------------------
//
// WORD granularity is safe; LETTER granularity is not. Devanagari's
// shirorekha -- the horizontal headline running across the top of a word --
// is one continuous bar. Give two letters of the same word different sizes
// and the bar visibly snaps in half. At a word boundary there is already a
// natural gap in the headline, so sizing whole words changes nothing about
// how the glyphs join. The Preeti key text is safe too: lrc_legacy.py splits
// and rejoins on spaces, so word boundaries survive the conversion.
//
// Word multipliers are expressed as PERCENTAGES of the parent, not pixels,
// so the outgoing line can still be shrunk as a whole (it renders at 0.62 /
// 0.8 of the current size) without its words escaping that scale.
function wordSpans(text, seed, index, amount) {
  return text.split(" ").map((w, i) => (
    <React.Fragment key={i}>
      {i > 0 ? " " : null}
      <span style={{ fontSize: (sizeFor(seed, index, amount, "w" + i) * 100).toFixed(2) + "%" }}>
        {w}
      </span>
    </React.Fragment>
  ));
}

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
    case "glow":
      // The reference-video look: white core with a soft bloom. Text-shadow
      // carries the glow; scale eases from slightly larger (light gathering).
      s.textShadow = `0 0 ${(18 + j * 14).toFixed(1)}px rgba(255,255,255,0.95), 0 0 ${(60 + j * 40).toFixed(1)}px rgba(255,255,255,0.55)`;
      s.transform = `scale(${(1.04 - 0.04 * inE).toFixed(4)})`;
      break;
    case "fade":
    default:
      break;
  }
  return s;
}

export const LyricOverlay = ({ cues, seed, style, fontSize, color, shadow, position, background, mode, sizeMode, sizeVar }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const master = seed || "song";

  // Random font size for this line. "phrase" scales the whole line once,
  // "word" varies each word (the div stays at fontSize and the words carry
  // relative sizes), anything else leaves the text exactly as it was.
  const planSize = (text, index) => {
    const amount = Number(sizeVar) || 0;
    if (sizeMode === "phrase") {
      return { size: fontSize * sizeFor(master, index, amount), content: text };
    }
    if (sizeMode === "word") {
      return { size: fontSize, content: wordSpans(text, master, index, amount) };
    }
    return { size: fontSize, content: text };
  };

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

  // Roam mode: each line owns a seeded position (the reference-video style).
  // Position comes from the CUE's own index, so the previous line keeps its
  // spot while fading — the two briefly coexist at different places.
  const roam = mode === "roam";
  const layout = (cueIndex) => {
    if (!roam) return null;
    const p = positionFor(seed || "song", cueIndex);
    return {
      position: "absolute",
      left: p.x + "%",
      top: p.y + "%",
      transform: "translate(-50%, -50%)",
    };
  };

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

  // Size plan, resolved once for both the current line and the outgoing one.
  const cur = planSize(cue.text, cue.index);
  const pv = prev ? planSize(prev.text, prev.index) : null;

  const textStyle = {
    fontFamily: FONT_FAMILY,
    fontWeight: 700,
    ...(LEGACY_FONT_FAMILY ? { fontWeight: 400 } : {}),
    color,
    textShadow: shadow,
    fontSize,
    lineHeight: 1.32,
    textAlign: "center",
    whiteSpace: "pre-wrap",
    margin: 0,
    // Roam text is positioned, not centered: cap the width so a long line
    // wraps instead of crossing the whole frame.
    ...(roam ? { maxWidth: "60vw" } : {}),
  };

  if (roam) {
    // In roam the outgoing line fades IN PLACE at its own position (measured
    // behaviour of the reference video) instead of drifting to a fixed slot.
    // The entrance/exit transform (st) goes on an INNER element: putting it
    // on the positioned div let glow's scale() overwrite translate(-50%,-50%)
    // and the block hung off the right edge of the frame.
    const prevPos = prev ? layout(prev.index) : null;
    return (
      <AbsoluteFill style={frameStyle}>
        {prev && prevLife < 1 ? (
          <div
            style={{
              ...textStyle,
              ...prevPos,
              opacity: (1 - prevLife) * 0.75,
              fontSize: pv.size * 0.8,
            }}
          >
            {pv.content}
          </div>
        ) : null}
        <div style={{ ...textStyle, fontSize: cur.size, ...layout(cue.index) }}>
          <div style={{ ...st, display: "inline-block" }}>{cur.content}</div>
        </div>
      </AbsoluteFill>
    );
  }

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
            fontSize: pv.size * 0.62,
            opacity: (1 - prevLife) * 0.75,
            transform: `translateY(${-prevLife * 30}px)`,
          }}
        >
          {pv.content}
        </div>
      ) : null}

      <div style={{ ...textStyle, fontSize: cur.size, ...st }}>{cur.content}</div>
    </AbsoluteFill>
  );
};
