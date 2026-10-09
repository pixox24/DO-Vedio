import path from "node:path";
import { promises as fs } from "node:fs";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { emptyDoc, focusPresetIds, type Aspect, type FocusPresetId } from "../lib/core/types";
import { blankShot } from "../lib/core/shots";
import { buildTimeline } from "../lib/core/timeline";

const root = process.cwd();
const output = path.join(root, "tmp/focus-text-probe");
const samples = ["见", "看见不同", "每一次选择都重要", "85%"];
function fixture(aspect: Aspect, presets: readonly FocusPresetId[], representative = false) {
  const doc = emptyDoc();
  doc.settings.music.enabled = false;
  doc.settings.aiLabel.enabled = false;
  doc.settings.subtitle.animation = "none";
  doc.settings.subtitle.preset = "cinematic-bilingual";
  doc.settings.subtitle.fontId = "system-cjk";
  doc.settings.subtitle.positionY = 82;
  doc.settings.subtitle.showBackground = false;
  doc.settings.subtitle.primaryColor = "#eeeeee";
  const textAt = (i: number) => representative ? samples[i % 4] : ["vertical-arc", "tilt-vertical"].includes(presets[i]) ? "留白" : samples[i % 4];
  doc.lines = presets.map((preset, i) => ({ id: String(i), segmentIndex: 0, text: textAt(i) === "85%" ? "用户留存提高到85%。" : "把注意力留给真正重要的事。", spans: [], keywords: [], locked: false }));
  doc.shots = presets.map((preset, i) => ({ ...blankShot(preset, String(i)), mode: "motion" as const, motion: "none" as const, transitionIn: "cut" as const, focusText: { text: textAt(i), support: textAt(i) === "85%" ? "用户留存" : "保留重点", layoutMode: "manual" as const, presetId: preset } }));
  const tts = new Map(doc.lines.map((line) => [line.id, { assetId: "fixture", durationMs: 2800, speechStartMs: 0, speechEndMs: 2800, chars: [], aligned: false, spokenChars: line.text.length }]));
  const timeline = buildTimeline(doc, { tts, tracks: new Map(), media: () => "" }, aspect);
  timeline.voice = [];
  return { timeline };
}
async function main() {
  await fs.mkdir(output, { recursive: true });
  await ensureBrowser();
  const serveUrl = await bundle({ entryPoint: path.join(root, "remotion/index.ts"), publicDir: path.join(root, "public"), webpackOverride: (config) => ({ ...config, resolve: { ...config.resolve, alias: { ...(config.resolve?.alias as object), "@": root } } }) });
  for (const aspect of ["16:9", "9:16"] as const) {
    const label = aspect === "16:9" ? "landscape" : "portrait";
    const inputProps = fixture(aspect, focusPresetIds);
    const base = await selectComposition({ serveUrl, id: "Video", inputProps });
    const composition = { ...base, width: inputProps.timeline.width, height: inputProps.timeline.height, durationInFrames: inputProps.timeline.durationInFrames };
    await fs.writeFile(path.join(output, `${label}-timeline.json`), JSON.stringify(inputProps, null, 2));
    for (let i = 0; !process.argv.includes("--video-only") && i < focusPresetIds.length; i++) {
      const shot = inputProps.timeline.shots[i];
      await renderStill({ serveUrl, composition, inputProps, frame: Math.round(shot.startMs / 1000 * 30) + 36, output: path.join(output, `${label}-${String(i + 1).padStart(2, "0")}-${focusPresetIds[i]}.png`), scale: .45, logLevel: "warn" });
    }
    const videoProps = fixture(aspect, ["vertical-arc", "diamond", "masked-slice", "three-dots"], true);
    await renderMedia({ serveUrl, composition: { ...composition, props: videoProps, durationInFrames: videoProps.timeline.durationInFrames }, inputProps: videoProps, codec: "h264", outputLocation: path.join(output, `${label}.mp4`), scale: .45, crf: 23, x264Preset: "veryfast", enforceAudioTrack: false, concurrency: 2, logLevel: "warn" });
    console.log(`${label}: 18 stills + animated preview in ${output}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
