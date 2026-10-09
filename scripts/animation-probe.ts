import path from "node:path";
import { promises as fs } from "node:fs";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { defaultTheme } from "../lib/core/theme";
import { motionProfile } from "../lib/core/motion";
import { DEFAULT_SUBTITLE_CONFIG } from "../lib/core/subtitle";
import type { Timeline } from "../lib/core/timeline";
import { legacyTemplateIds, type LegacyTemplateId } from "../lib/core/types";

const root = process.cwd();
const outputDir = path.join(root, ".tmp-animation-probe");
const probePort = Number(process.env.ANIMATION_PROBE_PORT ?? 3100);

function timeline(aspect: "16:9" | "9:16"): Timeline {
  const portrait = aspect === "9:16";
  const width = portrait ? 1080 : 1920;
  const height = portrait ? 1920 : 1080;
  const cards: Record<LegacyTemplateId, Timeline["shots"][number]["card"]> = {
    "creator-cinema-editorial-quote": { variant: "quote", headline: "你以为你在刷世界" },
    "hero-spotlight-stage": { variant: "headline", headline: "新的章节" },
    "hero-split-wipe": { variant: "split", sides: ["过去", "现在"] },
    "card-stat": { variant: "stat", stat: { value: "5000", unit: "元", label: "每月房租" } },
    "card-list": { variant: "list", headline: "三座山", items: ["住房", "托育", "加班"] },
    "card-qa": { variant: "qa", qa: { question: "为什么刷不停？", answer: "推荐在替你选" } },
    "card-cta": { variant: "cta", cta: { action: "现在就关", subtitle: "只要三秒" } },
    "card-alert": { variant: "alert", alert: { type: "warning", content: "先放下手机" } },
    "card-definition": { variant: "definition", definition: { term: "信息茧房", meaning: "只看见赞同的声音" } },
    "card-timeline": { variant: "timeline", timeline: [{ time: "2018", event: "立项" }, { time: "2020", event: "上线" }] },
    "card-profile": { variant: "profile", profile: { name: "林夏", role: "讲述者", bio: "把问题说清楚" } },
  };
  const compositeFixture = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' x2='1'%3E%3Cstop stop-color='%2310213a'/%3E%3Cstop offset='1' stop-color='%23d46a52'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='1920' height='1080' fill='url(%23g)'/%3E%3Ccircle cx='1450' cy='340' r='260' fill='%23f4d35e' fill-opacity='.72'/%3E%3Ctext x='120' y='880' fill='white' font-size='92' font-family='sans-serif'%3ECOMPOSITE FIXTURE%3C/text%3E%3C/svg%3E";
  const templateShots = legacyTemplateIds.map((templateId, index) => {
    const startMs = index * 1000;
    const card = cards[templateId];
    return {
      shotId: `animation-probe-${templateId}`,
      kind: "placeholder" as const,
      startMs,
      endMs: startMs + 1000,
      motion: "none" as const,
      description: "",
      onScreenText: card.headline || card.stat?.value || card.qa?.question || card.cta?.action || card.alert?.content || card.definition?.term || card.profile?.name || templateId,
      caption: card.headline || templateId,
      keywords: [],
      seed: index + 11,
      mode: "motion" as const,
      card,
      animation: { family: "none" as const, templateId, intensity: 2 as const, anchors: [], params: {} },
      safeArea: { bottomRatio: portrait ? 0.3 : 0.12, sideRatio: portrait ? 0.08 : 0.04 },
      transitionIn: index ? "fade" as const : "cut" as const,
      overlapInFrames: index ? 8 : 0,
      overlapOutFrames: 8,
    };
  });
  const shots = [...templateShots, {
    shotId: "animation-probe-composite",
    kind: "image" as const,
    startMs: templateShots.length * 1000,
    endMs: templateShots.length * 1000 + 1000,
    motion: "none" as const,
    description: "",
    onScreenText: "复合画面",
    caption: "复合画面",
    keywords: [],
    seed: 99,
    mode: "composite" as const,
    imageSrc: compositeFixture,
    card: { variant: "headline" as const, headline: "复合画面" },
    animation: { family: "none" as const, intensity: 1 as const, anchors: [], params: {} },
    safeArea: { bottomRatio: portrait ? 0.3 : 0.12, sideRatio: portrait ? 0.08 : 0.04 },
    transitionIn: "fade" as const,
    overlapInFrames: 8,
    overlapOutFrames: 0,
  }];
  const cues = shots.map((shot) => ({ startMs: shot.startMs, endMs: shot.endMs, lineId: shot.shotId, text: portrait ? "这是一条较长的字幕，用来确认动画自动避让底部字幕区域" : "这是一条较长的字幕，用来确认动画自动避让底部字幕区域", highlights: [] as [number, number][] }));
  return {
    outputSpecId: portrait ? "portrait-1080p" : "landscape-1080p",
    fps: 30,
    width,
    height,
    aspect,
    durationMs: 12000,
    durationInFrames: 360,
    title: "卡片模板验证",
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
    const composition = await selectComposition({ serveUrl, id: "Video", inputProps: props, port: probePort });
    const outputLocation = path.join(outputDir, `${aspect === "16:9" ? "landscape" : "portrait"}.mp4`);
    await renderMedia({ serveUrl, composition, inputProps: props, codec: "h264", outputLocation, crf: 28, scale: 0.35, x264Preset: "veryfast", pixelFormat: "yuv420p", imageFormat: "jpeg", jpegQuality: 72, enforceAudioTrack: false, chromiumOptions: { gl: "angle" }, port: probePort, logLevel: "warn" });
    console.log(`${aspect}: ${outputLocation}`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
