import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evenChars } from "@/lib/core/align";
import { castSourceHash } from "@/lib/core/cast";
import { RENDER_OUTPUT_VERSION } from "@/lib/core/keys";
import { blankShot, stampShots } from "@/lib/core/shots";
import { primaryHash } from "@/lib/core/subtitle/secondary";
import { subtitleTranslateKey } from "@/lib/core/subtitle/translate-plan";
import { emptyDoc, type Line, type ProjectDoc } from "@/lib/core/types";

let dir = "";
const oldKey = process.env.DEEPSEEK_API_KEY;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-subtitle-plan-"));
  process.env.DATA_DIR = dir;
  process.env.DEEPSEEK_API_KEY = "test-key";
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
  if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = oldKey;
});

function readyDoc(text = "一句已经配好的文案。"): ProjectDoc {
  const doc = emptyDoc();
  const line: Line = { id: "line-0", segmentIndex: 0, text, spans: [], keywords: [], locked: true };
  doc.lines = [line];
  doc.segments = [{ title: "开场", text }];
  doc.shots = stampShots([blankShot("shot-1", "line-0")], doc.lines);
  doc.castAnalysis = { sourceHash: castSourceHash(doc), modes: [], skipped: [], issues: [] };
  return doc;
}

async function cacheVoice(doc: ProjectDoc, projectId: string) {
  const { cachePut } = await import("@/lib/server/cache");
  const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
  for (const item of lineTtsKeys(doc, projectId)) {
    cachePut(item.key, "tts", { assetId: "a".repeat(64), durationMs: 1400, speechStartMs: 200, speechEndMs: 1200, chars: evenChars(item.spoken, 200, 1200), aligned: true, spokenChars: item.spoken.length });
  }
}

const goal = { until: "render" as const, aspects: ["16:9" as const], quality: "final" as const };

describe("双语翻译进入开工计划", () => {
  it("双语关着时不排翻译，也不挡住渲染", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { planPipeline } = await import("@/lib/pipeline/plan");
    const doc = readyDoc();
    const project = createProject(doc);
    await cacheVoice(doc, project.id);
    const plan = planPipeline(project.id, doc, goal);
    expect(plan.steps.some((step) => step.stage === "subtitle-translate")).toBe(false);
    expect(plan.currentKeys.some((key) => key.startsWith("subtitle-translate:"))).toBe(false);
    expect(plan.steps.some((step) => step.stage === "render")).toBe(true);
    expect(plan.costYuan).toBe(0);
  });

  it("双语开着且有句子没译时先翻译，不排渲染", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { planPipeline } = await import("@/lib/pipeline/plan");
    const { listTextModels } = await import("@/lib/providers/registry");
    const doc = readyDoc();
    doc.settings.subtitle.bilingual = true;
    const project = createProject(doc);
    await cacheVoice(doc, project.id);
    const plan = planPipeline(project.id, doc, goal);
    const step = plan.steps.find((item) => item.stage === "subtitle-translate");
    expect(step?.input).toMatchObject({ modelId: listTextModels()[0].id });
    expect(step?.target).toBe("翻译 1 句");
    expect(step?.cost).toBeGreaterThan(0);
    expect(step?.key).toBe(subtitleTranslateKey(project.id, doc.lines));
    expect(plan.steps.some((item) => item.stage === "render")).toBe(false);
    expect(plan.waiting).toContain("还有 1 句没有翻译");
    expect(plan.currentKeys).toContain(subtitleTranslateKey(project.id, doc.lines));
  });

  it("译文已经对上时不再调用模型，渲染可以开始", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { planPipeline } = await import("@/lib/pipeline/plan");
    const doc = readyDoc();
    doc.settings.subtitle.bilingual = true;
    doc.lines[0].secondaryText = "A line that is ready.";
    doc.lines[0].secondaryHash = primaryHash(doc.lines[0].text);
    const project = createProject(doc);
    await cacheVoice(doc, project.id);
    const plan = planPipeline(project.id, doc, goal);
    expect(plan.steps.some((step) => step.stage === "subtitle-translate")).toBe(false);
    expect(plan.steps.some((step) => step.stage === "render")).toBe(true);
    expect(plan.costYuan).toBe(0);
    expect(plan.currentKeys).toContain(subtitleTranslateKey(project.id, doc.lines));
  });

  it("纯数字不挡住成片", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { planPipeline } = await import("@/lib/pipeline/plan");
    const doc = readyDoc("12");
    doc.settings.subtitle.bilingual = true;
    const project = createProject(doc);
    await cacheVoice(doc, project.id);
    const plan = planPipeline(project.id, doc, goal);
    expect(plan.steps.some((step) => step.stage === "subtitle-translate")).toBe(false);
    expect(plan.steps.some((step) => step.stage === "render")).toBe(true);
  });

  it("还有句子要译时，后台追成片不提交渲染", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { run } = await import("@/lib/server/db");
    const { startCatchUp } = await import("@/lib/pipeline/catch-up");
    const doc = readyDoc();
    doc.settings.subtitle.bilingual = true;
    const project = createProject(doc);
    await cacheVoice(doc, project.id);
    run(
      "INSERT INTO renders (id, project_id, aspect, quality, timeline_hash, content_hash, animation_hash, video_hash, duration_ms, created_at, output_version, origin) VALUES (?, ?, '16:9', 'final', 'old', 'old', 'old', 'video', 1000, ?, ?, 'manual')",
      "render-old",
      project.id,
      Date.now(),
      RENDER_OUTPUT_VERSION,
    );
    expect(startCatchUp(project.id)).toMatchObject({ action: "skipped", reason: "还有 1 句没有翻译" });
  });
});
