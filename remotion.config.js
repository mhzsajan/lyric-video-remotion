// Remotion reads the package "type" to decide webpack's sourceType. With
// "commonjs" the entry point is parsed as a script and every `import` throws
// "may appear only with sourceType: module". This file is ESM to match.
import { Config } from "@remotion/cli/config";

Config.setEntryPoint("src/index.js");

// PNG frames, not JPEG: JPEG has no alpha, which would flatten the overlay's
// transparency into a black matte.
Config.setVideoImageFormat("png");

// Codec and ProRes profile are deliberately NOT pinned here. The composition
// declares prores/4444 as its default, and render.mjs passes explicit flags
// per mode -- pinning them globally makes a `--codec=h264` preview run fail
// with "you have set a ProRes profile but the codec is h264".
Config.setChromiumOpenGlRenderer("angle");

export default Config;
