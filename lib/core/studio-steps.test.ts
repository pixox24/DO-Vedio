import { describe, expect, it } from "vitest";
import { evenChars } from "./align";
import type { TtsResult } from "./keys";
import { outputSpecsFor } from "./output-spec";
import { blankShot } from "./shots";
import { snapshotFor } from "./stock";
import { produceSteps, stepHints } from "./studio-steps";
import { buildTimeline } from "./timeline";
import { emptyDoc, type ProjectDoc, type Shot } from "./types";

/**
 * 步骤条的形状与提示。
 *
 * 这两件事以前写在 `components/video-studio.tsx` 的 JSX 里，只能靠肉眼验收——
 * 素材管线一加进来，最典型的回归就是「stock 被塞进 AI 视频那两步」，
 * 进度条上出现两个永远不动的格子。这里把三条管线的差别按断言钉住。
 */

const fakeTts = (text: string, ms: number): TtsResult => ({
  assetId: "a".repeat(64), durationMs: ms + 400, speechStartMs: 200, speechEndMs: 200 + ms,
  chars: evenChars(text, 200, 200 + ms), aligned: true, spokenChars: text.length,
});

function sample(pipeline: ProjectDoc["settings"]["visualPipeline"], count = 2) {
  const doc = emptyDoc();
  doc.settings.visualPipeline = pipeline;
  doc.lines = Array.from({ length: count }, (_, index) => ({ id: `l${index}`, text: `第${index}句话。`, segmentIndex: 0, locked: true, spans: [], keywords: [] }));
  doc.segments = [{ title: "测试", text: doc.lines.map((line) => line.text).join("") }];
  doc.shots = doc.lines.map<Shot>((line, index) => ({
    ...blankShot(`s${index}`, line.id),
    kind: "video", mode: "generate", groupId: "g",
    stockQuery: `window subject ${index}`,
    videoPlan: { startState: "A subject stands", action: "The subject turns", camera: "Static camera", endState: "The subject faces out" },
  }));
  const timeline = buildTimeline(doc, {
    tts: new Map(doc.lines.map((line) => [line.id, fakeTts(line.text, 1200)])),
    tracks: new Map(), media: (hash) => `/m/${hash}`,
  }, "16:9");
  return { doc, timeline };
}

const stagesOf = (steps: { stage: string }[]) => steps.map((step) => step.stage);

describe("步骤条按画面管线换形状", () => {
  it("图片驱动没有媒体步骤", () => {
    const stages = stagesOf(produceSteps(false, "image"));
    expect(stages).not.toContain("shot-stock");
    expect(stages).not.toContain("shot-reference");
    expect(stages).not.toContain("shot-generate");
    expect(stages).toContain("render");
  });

  it("AI 视频驱动是参考图 + 视频两步", () => {
    const stages = stagesOf(produceSteps(false, "video"));
    expect(stages).toEqual(expect.arrayContaining(["shot-reference", "shot-generate"]));
    expect(stages).not.toContain("shot-stock");
  });

  it("素材驱动只有检索素材一步，没有参考图和视频", () => {
    const stages = stagesOf(produceSteps(false, "stock"));
    expect(stages).toContain("shot-stock");
    expect(stages).not.toContain("shot-reference");
    expect(stages).not.toContain("shot-generate");
  });

  it("媒体步骤始终插在分镜与渲染之间，翻译也在这个位置", () => {
    for (const pipeline of ["image", "video", "stock"] as const) {
      const stages = stagesOf(produceSteps(true, pipeline));
      expect(stages.indexOf("storyboard")).toBeLessThan(stages.indexOf("render"));
      expect(stages.indexOf("subtitle-translate")).toBeLessThan(stages.indexOf("render"));
      expect(stages.indexOf("subtitle-translate")).toBeGreaterThan(stages.indexOf("storyboard"));
    }
  });

  it("不开双语就没有翻译步骤", () => {
    expect(stagesOf(produceSteps(false, "stock"))).not.toContain("subtitle-translate");
    // 六个基础步骤 + 检索素材
    expect(produceSteps(false, "stock")).toHaveLength(7);
  });
});

describe("素材管线的步骤提示", () => {
  it("分镜还没出来时让检索素材等待", () => {
    const { doc, timeline } = sample("stock");
    expect(stepHints(doc, [], true, timeline)["shot-stock"]).toEqual({ tone: "hold", message: "等待视频分镜" });
  });

  it("缺检索词时点名缺几镜", () => {
    const { doc, timeline } = sample("stock", 3);
    doc.shots[2].stockQuery = undefined;
    expect(stepHints(doc, [], false, timeline)["shot-stock"]).toEqual({ tone: "hold", message: "待补检索词 · 1 镜" });
  });

  it("检索词齐了但素材还没拿到时说待检索", () => {
    const { doc, timeline } = sample("stock", 2);
    expect(stepHints(doc, [], false, timeline)["shot-stock"]).toEqual({ tone: "hold", message: "待检索素材 · 2 镜" });
  });

  it("素材对上快照就是完成，且口径与渲染门禁一致", () => {
    const { doc, timeline } = sample("stock", 2);
    const frame = outputSpecsFor(doc.settings)[0];
    for (const shot of doc.shots) {
      const hash = snapshotFor(doc, shot, timeline, frame).hash;
      shot.assetVariants[frame.aspect] = { assetId: "f".repeat(64), promptHash: hash, aspect: frame.aspect, source: "generated" };
    }
    expect(stepHints(doc, [], false, timeline)["shot-stock"]).toEqual({ tone: "done" });
  });

  it("检索词改了之后已落库的素材算过期", () => {
    const { doc, timeline } = sample("stock", 1);
    const frame = outputSpecsFor(doc.settings)[0];
    const shot = doc.shots[0];
    shot.assetVariants[frame.aspect] = { assetId: "f".repeat(64), promptHash: snapshotFor(doc, shot, timeline, frame).hash, aspect: frame.aspect, source: "generated" };
    expect(stepHints(doc, [], false, timeline)["shot-stock"]).toEqual({ tone: "done" });
    // 提示用的指纹与快照同源：改检索词之后必须重新报缺，否则按钮会永远显示「已就绪」。
    shot.stockQuery = "mountain road drive";
    expect(stepHints(doc, [], false, timeline)["shot-stock"]).toEqual({ tone: "hold", message: "待检索素材 · 1 镜" });
  });

  it("锁定的镜头不计入待办", () => {
    const { doc, timeline } = sample("stock", 3);
    doc.shots.forEach((shot) => { shot.locked = true; });
    expect(stepHints(doc, [], false, timeline)["shot-stock"]).toEqual({ tone: "done" });
  });

  it("非素材管线不会冒出检索素材的提示", () => {
    const { doc, timeline } = sample("image");
    expect(stepHints(doc, [], false, timeline)["shot-stock"]).toBeUndefined();
    const video = sample("video");
    expect(stepHints(video.doc, [], true, video.timeline)).toMatchObject({
      "shot-reference": { tone: "hold", message: "等待视频分镜" },
      "shot-generate": { tone: "hold", message: "等待视频分镜" },
    });
  });
});
