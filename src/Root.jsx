import React from "react";
import { Composition, staticFile } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { parseLrc } from "./parse-lrc.mjs";
import { LyricOverlay } from "./LyricOverlay.jsx";
import { LRC_TEXT, AUDIO_FILE } from "./lyrics.generated.js";

const parsed = parseLrc(LRC_TEXT);
const WIDTH = Number(process.env.LYRIC_WIDTH || 1920);
const HEIGHT = Number(process.env.LYRIC_HEIGHT || 1080);

// If the audio cannot be probed, fall back to the last cue plus a tail. A
// slightly long clip is far safer than one that cuts the final line off.
const FALLBACK_SECONDS = Math.max(
  30,
  parsed.cues.length ? parsed.cues[parsed.cues.length - 1].end + 2 : 60
);

export const RemotionRoot = () => {
  return (
    <Composition
      id="LyricOverlay"
      component={LyricOverlay}
      durationInFrames={Math.round(FALLBACK_SECONDS * 30)}
      fps={30}
      width={WIDTH}
      height={HEIGHT}
      // ProRes 4444 = the alpha channel. Declared here so a bare
      // `remotion render` is correct with no extra flags.
      defaultCodec="prores"
      defaultProResProfile="4444"
      // Match the video to the song so the overlay never runs short.
      calculateMetadata={async ({ props }) => {
        let seconds = FALLBACK_SECONDS;
        if (AUDIO_FILE) {
          try {
            // Probe a resolved URL, not the bare "/name.mp3": the browser-side
            // decoder cannot fetch a root-relative path.
            const probed = await getAudioDurationInSeconds(staticFile(AUDIO_FILE));
            if (typeof probed === "number" && probed > 0) seconds = probed;
          } catch (e) {
            // keep the fallback
          }
        }
        const tail = parsed.cues.length ? parsed.cues[parsed.cues.length - 1].end : 0;
        // FPS is a PROP, not an env var: env is baked into the cached webpack
        // bundle, so a changed LYRIC_FPS was silently ignored on re-render and
        // the returned metadata then overrode the CLI --fps flag. Props arrive
        // at runtime and cannot go stale.
        const fps = Number(props.fps) || 30;
        // A preview only needs to reach the last sung line. Rendered as a
        // duration cap HERE rather than as a `--frames` range on the command
        // line: the two disagreed, because this number is max(audio length,
        // last cue) while --frames was last cue + a fixed 2s tail. Whenever the
        // song is shorter than its own last cue plus the tail -- Allare, 417.0s
        // audio against a 415.3s cue -- the range ran past the end and Remotion
        // refused: "durationInFrames ... 6257, but frame range 0-6259". One
        // place decides the length, so the two can never disagree.
        const full = Math.max(seconds, tail);
        const duration = props.preview ? Math.min(full, tail + 2) : full;
        return {
          durationInFrames: Math.round(duration * fps),
          fps,
          width: WIDTH,
          height: HEIGHT,
          props: { ...props, cues: parsed.cues, seed: parsed.title || "song" },
        };
      }}
      // Style comes in as PROPS, not process.env. Remotion statically replaces
      // process.env.X at build time, and an unset variable becomes the literal
      // string "undefined" -- which is truthy, so `process.env.LYRIC_COLOR ||
      // "#ffffff"` yields "undefined", an invalid CSS colour that silently
      // renders black. Number("undefined") is NaN, so the font size collapses
      // to the browser default too. Props cannot be mangled this way.
      defaultProps={{
        cues: parsed.cues,
        seed: parsed.title || "song",
        style: undefined,
        fontSize: 104,
        // Random font size: "word" varies every word of a line, "phrase"
        // scales the whole line once, "off" disables. sizeVar is the max
        // deviation from 1.0, clamped to 0.45 in render.mjs.
        sizeMode: "word",
        sizeVar: 0.15,
        // Word-by-word animation: "off" animates whole lines (previous
        // behaviour), otherwise each word is scheduled across the cue and
        // animates as it arrives. "reveal" | "karaoke" | "pulse".
        wordAnim: "off",
        // Title and band, read from the .lrc's [ti:] and [ar:]. They drive
        // the opening and closing cards; --title-card / --title-card-outro
        // turn them on.
        title: parsed.title || "",
        band: parsed.band || "",
        titleCard: false,
        titleCardOutro: false,
        // Per-letter layer, nested inside each word span. letterAnim is
        // fade|rise|pop|wipe; letterVar is per-letter SIZE, clamped to 0.12 in
        // src/letters.js because the shirorekha is continuous across a word.
        letterAnim: "off",
        letterVar: 0,
        fps: 30,
        // Preview caps the timeline at the last sung line + 2s. Resolved in
        // calculateMetadata alongside the rest of the length maths.
        preview: false,
        color: "#ffffff",
        // Soft dark halo keeps white text legible over a bright camera feed
        // without needing a background plate.
        shadow: "0 3px 18px rgba(0,0,0,0.55), 0 0 60px rgba(0,0,0,0.35)",
        position: "center",
        // "transparent" renders an alpha overlay (mov); render.mjs passes
        // "#000000" for mp4 so the plate is keyable with Add/Screen blend.
        background: "transparent",
      }}
    />
  );
};
