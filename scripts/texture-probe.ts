import path from "node:path";
import { promises as fs } from "node:fs";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { defaultTheme } from "../lib/core/theme";
import { motionProfile } from "../lib/core/motion";
import { DEFAULT_SUBTITLE_CONFIG } from "../lib/core/subtitle";
import type { Timeline } from "../lib/core/timeline";

const root = process.cwd();
const outputDir = path.join(root, ".tmp-render-probe");

function timeline(aspect: "16:9" | "9:16"): Timeline {
  const portrait = aspect === "9:16";
  const width = portrait ? 1080 : 1920;
  const height = portrait ? 1920 : 1080;
  return {
    outputSpecId: portrait ? "portrait-1080p" : "landscape-1080p",
    fps: 30,
    width,
    height,
    aspect,
    durationMs: 3000,
    durationInFrames: 90,
    title: "纹理验证",
    theme: { ...defaultTheme, motion: motionProfile("painterly-soft") },
    voice: [],
    lines: [],
    shots: [{
      shotId: "texture-probe-a",
      kind: "placeholder",
      startMs: 0,
      endMs: 1500,
      motion: "none",
      description: "",
      onScreenText: "纹理验证",
      caption: "",
      keywords: [],
      seed: 17,
      mode: "motion",
      card: { variant: "headline", headline: "纹理验证" },
      overlapOutFrames: 12,
    }, {
      shotId: "texture-probe-b",
      kind: "placeholder",
      startMs: 1500,
      endMs: 3000,
      motion: "none",
      description: "",
      onScreenText: "转场验证",
      caption: "",
      keywords: [],
      seed: 23,
      mode: "motion",
      transitionIn: "fade",
      overlapInFrames: 12,
      card: { variant: "headline", headline: "转场验证" },
    }],
    cues: [],
    subtitleBlocks: [],
    music: [],
    sfx: [],
    subtitle: { ...DEFAULT_SUBTITLE_CONFIG, enabled: false, highlight: false },
    aiLabel: { enabled: false, position: "top-right" },
    issues: [],
  };
}

async function main() {
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  await ensureBrowser();
  const serveUrl = await bundle({
    entryPoint: path.join(root, "remotion/index.ts"),
    outDir: path.join(outputDir, "bundle"),
    publicDir: path.join(root, "public"),
    webpackOverride: (config) => ({
      ...config,
      resolve: { ...config.resolve, alias: { ...(config.resolve?.alias as object), "@": root } },
    }),
  });
  for (const aspect of ["16:9", "9:16"] as const) {
    const props = { timeline: timeline(aspect) };
    const composition = await selectComposition({ serveUrl, id: "Main", inputProps: props, port: 3001 });
    const outputLocation = path.join(outputDir, `${aspect === "16:9" ? "landscape" : "portrait"}.mp4`);
    await renderMedia({
      serveUrl,
      composition,
      inputProps: props,
      codec: "h264",
      outputLocation,
      crf: 28,
      scale: 0.5,
      x264Preset: "veryfast",
      pixelFormat: "yuv420p",
      imageFormat: "jpeg",
      jpegQuality: 75,
      enforceAudioTrack: false,
      chromiumOptions: { gl: "angle" },
      port: 3001,
      logLevel: "warn",
    });
    console.log(`${aspect}: ${outputLocation}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
