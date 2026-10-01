import { animationMetrics } from "../lib/core/animation-metrics";
import { motionProfile, type MotionPresetId } from "../lib/core/motion";
import { DEFAULT_SUBTITLE_CONFIG } from "../lib/core/subtitle";
import type { Timeline, TimelineShot } from "../lib/core/timeline";
import { defaultTheme } from "../lib/core/theme";

const cases = [
  { id: "fiction", label: "虚构故事", families: ["editorial", "callout", "kinetic", "timeline"] as const },
  { id: "science", label: "硬核科普", families: ["stat", "process", "compare", "hud"] as const },
  { id: "opinion", label: "观点评论", families: ["kinetic", "editorial", "collage", "callout"] as const },
  { id: "history", label: "历史真实人物", families: ["timeline", "ink", "editorial", "callout"] as const },
  { id: "creator", label: "第一人称 UP 主吐槽", families: ["collage", "hud", "kinetic", "compare"] as const },
];
const presets: MotionPresetId[] = ["editorial-restrained", "geometric-editorial", "ink-bleed", "neon-hud"];

function fixture(families: readonly string[], preset: MotionPresetId): Timeline {
  const shots: TimelineShot[] = families.map((family, index) => ({
    shotId: `${family}-${index}`,
    kind: "placeholder",
    startMs: index * 1500,
    endMs: (index + 1) * 1500,
    motion: "none",
    description: "",
    onScreenText: `${family} 重点 ${index + 1}`,
    caption: family === "stat" ? "数据增长达到 42%" : "旁白正在解释这一段的背景与意义",
    keywords: [],
    seed: index + 1,
    mode: "motion",
    card: family === "stat" ? { variant: "stat", headline: "关键指标", stat: { value: "42%", label: "增长" } } : { variant: "headline", headline: `${family} 重点 ${index + 1}` },
    animation: { family: family as TimelineShot["animation"] extends infer A ? A extends { family: infer F } ? F : never : never, intensity: index === 1 ? 3 : 1, anchors: [], params: {} },
    safeArea: { bottomRatio: 0.12, sideRatio: 0.04 },
    transitionIn: index === 0 ? "cut" : index % 2 ? "fade" : "wipe",
  }));
  return { outputSpecId: "landscape-1080p", fps: 30, width: 1920, height: 1080, aspect: "16:9", durationMs: 6000, durationInFrames: 180, title: preset, theme: { ...defaultTheme, motion: motionProfile(preset) }, voice: [], lines: [], shots, cues: [], subtitleBlocks: [], music: [], sfx: [], subtitle: { ...DEFAULT_SUBTITLE_CONFIG, highlight: false }, aiLabel: { enabled: true, position: "top-right" }, issues: [] };
}

const reports = cases.flatMap((scenario) => presets.map((preset) => {
  const metrics = animationMetrics(fixture(scenario.families, preset));
  return { scenario: scenario.id, label: scenario.label, preset, familyEntropy: Number(metrics.familyEntropy.toFixed(3)), maxFamilyRun: metrics.maxFamilyRun, maxTransitionRun: metrics.maxTransitionRun, statTraceRate: metrics.statTraceRate, duplicateTextShots: metrics.duplicateTextShots.length, safeAreaViolations: metrics.safeAreaViolations.length, intensityVariance: Number(metrics.intensityVariance.toFixed(3)) };
}));

console.table(reports);
if (reports.some((report) => report.statTraceRate < 1 || report.duplicateTextShots > 0 || report.safeAreaViolations > 0)) {
  console.error("animation evaluation failed: provenance, duplicate text, or safe-area threshold");
  process.exitCode = 1;
}
