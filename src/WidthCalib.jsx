// WidthCalib.jsx -- one sample line drawn as bare text, to be measured.
//
// WHY A SEPARATE COMPOSITION
// -------------------------
// The overlay cannot measure itself. It has to decide a font size BEFORE it
// renders, and everything in it -- the band width, the auto-fit, the entrance
// transform, the shadow -- would change the thing being measured. Calibrating
// through the overlay therefore measures the renderer's current guesses, and
// the guesses get baked in as though they were the font.
//
// So this renders what the browser does to plain text and nothing else: no
// band, no fit, no animation, no shadow, no background.
//
// ONE SAMPLE PER IMAGE, NOT TEN BANDS IN ONE
// ------------------------------------------
// The first version put all ten samples in one 2400px frame, 220px per band,
// and scanned each band for ink. It produced nonsense -- five Devanagari digits
// "measuring" 1782px, a conjunct measuring 222% of prediction -- because a
// Devanagari matra at 200px extends well outside its 200px line box. Every
// band's ink included its neighbours', so the measurements were of the union of
// two or three samples, and the least-squares fit had nothing real to work
// with.
//
// Measuring one line per image removes the band arithmetic entirely: there is
// no boundary to get wrong, so the extent is just the extent. It costs ten
// renders instead of one, but the bundle is built once and each still after
// that is fast, and correctness here is worth more than the seconds.
//
// The font stack is imported from width-model.mjs rather than repeated, because
// the calibration has to measure the face the overlay will actually use. The
// overlay asks for Noto Sans Devanagari FIRST and Nirmala UI second, so a
// calibration that measured Nirmala would be measuring a font that never
// appears in the video -- the same "confidently wrong number" failure as
// everything else this file exists to remove.

import React from "react";
import { AbsoluteFill, staticFile, delayRender, continueRender } from "remotion";
import { SAMPLE_PX, SAMPLE_W, SAMPLE_H, SAMPLE_LEFT, OVERLAY_FONT_STACK, SAMPLES } from "./width-model.mjs";
import { CALIB_SAMPLES, CALIB_MODEL } from "./calib-samples.generated.js";
import { FONT_FILE, FONT_FAMILY_NAME, LEGACY_FONT_FILE, LEGACY_FONT_FAMILY } from "./lyrics.generated.js";

// The font has to be registered HERE, not relied on from LyricOverlay.
//
// The calibration renders the WidthCalib composition, and that composition does
// not import LyricOverlay -- so the FontFace registration at the top of that
// file never runs. The stack fell through to Nirmala UI and the fit came out
// BIT-IDENTICAL to the Nirmala one: cons 0.6287, matra 0, space 0.4470 for both.
// Fifteen candidates were "compared" and every one of them was the system font.
//
// A wrong-but-plausible number is the failure this whole file exists to
// eliminate, so the registration is duplicated here rather than shared: the cost
// is six lines, and the alternative is a shared module that both compositions
// import, which is the right answer once a second consumer exists.
const FILE = LEGACY_FONT_FILE || FONT_FILE;
const NAME = LEGACY_FONT_FAMILY || FONT_FAMILY_NAME;

if (FILE && NAME) {
  const handle = delayRender(`calib font: ${NAME}`);
  const face = new FontFace(
    NAME,
    `url('${staticFile("fonts/" + FILE)}') format('truetype')`,
    LEGACY_FONT_FILE ? { weight: "400" } : {}
  );
  face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded);
      continueRender(handle);
    })
    .catch((err) => {
      // Said out loud, because the alternative is a silent wrong measurement.
      console.error(`Calibration font failed: ${NAME} (${FILE})`, err);
      continueRender(handle);
    });
}

export const WidthCalib = ({ font, index }) => {
  // The sample arrives as an INDEX, not as text. A Devanagari string passed
  // through inputProps is the one thing here that can be mangled in transit --
  // a shell or an encoding layer turns it into "??????" and the frame measures
  // the replacement characters instead of the script. An index cannot.
  //
  // The list itself comes from a GENERATED module, because the calibration
  // appends the song's own lines to it and those have to reach the composition
  // somehow. Reading SAMPLES[index] off a list the composition does not have is
  // the same silent failure from the other end: undefined renders nothing, and
  // nothing measures as zero.
  const list = Array.isArray(CALIB_SAMPLES) && CALIB_SAMPLES.length
    ? CALIB_SAMPLES
    : SAMPLES;
  const line = list[index] ?? "";
  // The registered face must lead the stack. Without it the browser resolves
  // "Nirmala UI" -- and the measurement is of the wrong font, which is the one
  // thing this whole script must never be.
  const family = (font || NAME) ? '"' + (font || NAME) + '", ' + OVERLAY_FONT_STACK : OVERLAY_FONT_STACK;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000000",
        color: "#ffffff",
        padding: 0,
        margin: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: SAMPLE_LEFT,
          top: Math.round(SAMPLE_H * 0.3),
          width: SAMPLE_W,
          fontFamily: family,
          fontSize: SAMPLE_PX,
          lineHeight: 1,
          fontWeight: 400,
          whiteSpace: "pre",
          textAlign: "left",
          // No text-shadow and no letter-spacing: both change the advance, and
          // neither is in the lyrics, so including them would fit a string that
          // is never drawn. A soft halo in particular would extend every
          // sample by the same blur radius, which is the one thing a width
          // measurement must not do.
        }}
      >
        {line}
      </div>
    </AbsoluteFill>
  );
};
