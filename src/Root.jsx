import React from "react";
import { Composition, Audio, staticFile } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { parseLrc } from "./parse-lrc.mjs";
import { LyricOverlay } from "./LyricOverlay.jsx";

// The .lrc is bundled at build time so rendering needs no file plumbing.
// render.mjs regenerates this before each render.
import { LRC_TEXT, AUDIO_FILE } from "./lyrics.generated.js";

const parsed = parseLrc(LRC_TEXT);
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 60;
// Fallback if the audio cannot be probed (e.g. probing in a browser context).
const FALLBACK_SECONDS = Math.max(
  30,
  parsed.cues.length ? parsed.cues[parsed.cues.length - 1].end + 2 : 60
);

export const RemotionRoot = () => {
  return (
    <Composition
      id="LyricOverlay"
      component={LyricOverlay}
      durationInFrames={Math.round(FALLBACK_SECONDS * FPS)}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      // ProRes 4444 = the alpha channel. Set on the composition so a bare
      // `remotion render` is correct without extra flags.
      defaultCodec="prores"
      defaultProResProfile="4444"
      // Match the video to the audio length so the overlay never runs short.
      calculateMetadata={async ({ props }) => {
        let seconds = FALLBACK_SECONDS;
        if (AUDIO_FILE) {
          try {
            // Must probe a resolved URL, not the bare "/name.mp3": the
            // browser-side decoder cannot fetch a root-relative path.
            const probed = await getAudioDurationInSeconds(staticFile(AUDIO_FILE));
            if (typeof probed === "number" && probed > 0) seconds = probed;
          } catch (e) {
            // Keep the fallback; a slightly long clip is safer than a short one.
          }
        }
        const tail = parsed.cues.length
          ? parsed.cues[parsed.cues.length - 1].end
          : 0;
        return {
          durationInFrames: Math.round(Math.max(seconds, tail) * FPS),
          fps: FPS,
          width: WIDTH,
          height: HEIGHT,
          props: { ...props, cues: parsed.cues, seed: parsed.title || "song" },
        };
      }}
      props={{
        cues: parsed.cues,
        seed: parsed.title || "song",
        style: process.env.LYRIC_STYLE || undefined,
        fontSize: Number(process.env.LYRIC_FONT_SIZE || 104),
        color: process.env.LYRIC_COLOR || "#ffffff",
        // A soft dark halo keeps white text legible over a bright camera feed
        // without needing a background plate.
        shadow:
          process.env.LYRIC_SHADOW ||
          "0 3px 18px rgba(0,0,0,0.55), 0 0 60px rgba(0,0,0,0.35)",
        position: process.env.LYRIC_POSITION || "center",
      }}
    />
  );
};
