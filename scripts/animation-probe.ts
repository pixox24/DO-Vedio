import path from "node:path";
import { promises as fs } from "node:fs";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { defaultTheme } from "../lib/core/theme";
import { motionProfile } from "../lib/core/motion";
import { DEFAULT_SUBTITLE_CONFIG } from "../lib/core/subtitle";
import type { Timeline } from "../lib/core/timeline";

const root = process.cwd();
const outputDir = path.join(root, ".tmp-animation-probe");
const probePort = Number(process.env.ANIMATION_PROBE_PORT ?? 3100);

function timeline(aspect: "16:9" | "9:16"): Timeline {
  const portrait = aspect === "9:16";
  const width = portrait ? 1080 : 1920;
  const height = portrait ? 1920 : 1080;
  const families = ["editorial", "kinetic", "stat", "compare", "process", "callout", "timeline", "collage", "hud", "ink"] as const;
  const captions = ["观点先亮出来", "住房与收入的对比", "五千元房租", "过去与现在", "住房 → 托育 → 加班", "重点信息", "时间线", "拼贴重点", "系统状态", "墨线重点"];
  const compositeFixture = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1'%3E%3Cstop stop-color='%2310213a'/%3E%3Cstop offset='1' stop-color='%23d46a52'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='1920' height='1080' fill='url(%23g)'/%3E%3Ccircle cx='1450' cy='340' r='260' fill='%23f4d35e' fill-opacity='.72'/%3E%3Ctext x='120' y='880' fill='white' font-size='92' font-family='sans-serif'%3ECOMPOSITE FIXTURE%3C/text%3E%3C/svg%3E";
  const shots = families.map((family, index) => {
    const composite = family === "ink";
    const startMs = index * 1000;
    const card = family === "stat"
      ? { variant: "stat" as const, headline: "房租", stat: { value: "5000", unit: "元", label: "每月房租" } }
      : family === "compare"
        ? { variant: "split" as const, sides: ["过去", "现在"] as [string, string], headline: "生活成本" }
        : family === "process"
          ? { variant: "list" as const, items: ["住房", "托育", "加班"], headline: "三座山" }
      : family === "timeline"
        ? { variant: "list" as const, headline: "时间线", items: ["起点", "转折", "现在"] }
        : { variant: "headline" as const, headline: captions[index] };
    return {
      shotId: `animation-probe-${family}`,
      kind: composite ? "image" as const : "placeholder" as const,
      startMs,
      endMs: startMs + 1000,
      motion: "none" as const,
      description: "",
      onScreenText: captions[index],
      caption: captions[index],
      keywords: [],
      seed: index + 11,
      mode: composite ? "composite" as const : "motion" as const,
      imageSrc: composite ? compositeFixture : undefined,
      card,
      animation: {
        family,
        templateId: family === "editorial" ? "creator-cinema-editorial-quote" as const : family === "compare" ? "hero-split-wipe" as const : family === "kinetic" ? "hero-spotlight-stage" as const : undefined,
        intensity: 2 as const,
        anchors: [],
        params: {},
      },
      safeArea: { bottomRatio: portrait ? 0.3 : 0.12, sideRatio: portrait ? 0.08 : 0.04 },
      transitionIn: index ? "fade" as const : "cut" as const,
      overlapInFrames: index ? 8 : 0,
      overlapOutFrames: index < families.length - 1 ? 8 : 0,
    };
  });
  const cues = shots.map((shot) => ({ startMs: shot.startMs, endMs: shot.endMs, lineId: shot.shotId, text: portrait ? "这是一条较长的字幕，用来确认动画自动避让底部字幕区域" : "这是一条较长的字幕，用来确认动画自动避让底部字幕区域", highlights: [] as [number, number][] }));
  return {
    outputSpecId: portrait ? "portrait-1080p" : "landscape-1080p",
    fps: 30,
    width,
    height,
    aspect,
    durationMs: 10000,
    durationInFrames: 300,
    title: "动画家族验证",
    theme: { ...defaultTheme, motion: motionProfile("geometric-editorial") },
    voice: [],
    lines: [],
    shots,
    cues,
    subtitleBlocks: [],
    music: [],
    sfx: [],
    subtitle: { ...DEFAULT_SUBTITLE_CONFIG, highlight: false },
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
    webpackOverride: (config) => ({ ...config, resolve: { ...config.resolve, alias: { ...(config.resolve?.alias as object), "@": root } } }),
  });
  for (const aspect of ["16:9", "9:16"] as const) {
    const props = { timeline: timeline(aspect) };
    const composition = await selectComposition({ serveUrl, id: "Main", inputProps: props, port: probePort });
    const outputLocation = path.join(outputDir, `${aspect === "16:9" ? "landscape" : "portrait"}.mp4`);
    await renderMedia({ serveUrl, composition, inputProps: props, codec: "h264", outputLocation, crf: 28, scale: 0.35, x264Preset: "veryfast", pixelFormat: "yuv420p", imageFormat: "jpeg", jpegQuality: 72, enforceAudioTrack: false, chromiumOptions: { gl: "angle" }, port: probePort, logLevel: "warn" });
    console.log(`${aspect}: ${outputLocation}`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
