import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDoc } from "@/lib/core/types";

let dir = "";
const oldKey = process.env.DEEPSEEK_API_KEY;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-pipeline-model-"));
  process.env.DATA_DIR = dir;
  process.env.DEEPSEEK_API_KEY = "test-key";
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
  if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = oldKey;
});

describe("自动分镜推进", () => {
  it("文案页默认模型未写入文档时仍会规划分镜", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { cachePut } = await import("@/lib/server/cache");
    const { lineSpeech, ttsKey } = await import("@/lib/core/keys");
    const { planPipeline } = await import("@/lib/pipeline/plan");
    const { listTextModels } = await import("@/lib/providers/registry");
    const doc = emptyDoc();
    doc.segments = [{ title: "开场", text: "一句测试文案。" }];
    doc.lines = [{ id: "line-1", segmentIndex: 0, text: "一句测试文案。", spans: [], keywords: [], locked: true }];
    const project = createProject(doc);
    cachePut(ttsKey(lineSpeech(doc.lines[0], []).spoken, doc.settings.voice), "tts", { assetId: "test", speechStartMs: 0, speechEndMs: 1000, durationMs: 1000, chars: [], aligned: false, spokenChars: 7 });
    const goal: Parameters<typeof planPipeline>[2] = { until: "render", aspects: ["16:9"], quality: "draft" };
    // 先识别角色和场景（和配音并行），分镜等它完成
    const first = planPipeline(project.id, doc, goal);
    expect(first.steps.find((step) => step.stage === "cast")?.input).toMatchObject({ modelId: listTextModels()[0].id });
    expect(first.steps.some((step) => step.stage === "storyboard")).toBe(false);
    expect(first.waiting).toContain("等待识别角色和场景");
    const { castSourceHash } = await import("@/lib/core/cast");
    const cast = { ...doc, castAnalysis: { sourceHash: castSourceHash(doc), modes: [], skipped: [], issues: [] } };
    const plan = planPipeline(project.id, cast, goal);
    expect(plan.steps.some((step) => step.stage === "cast")).toBe(false);
    expect(plan.steps.find((step) => step.stage === "storyboard")?.input).toMatchObject({ modelId: listTextModels()[0].id });
    expect(plan.waiting).not.toContain("没有可用文本模型，请在模型中心配置并启用");
    expect(plan.steps.some((step) => step.stage === "music")).toBe(false);
    expect(plan.waiting.join(" ")).not.toContain("配乐");
  });

  it("Qwen-Audio 在配音前写全片说明，失败或已填写时不挡住配音", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { cachePut } = await import("@/lib/server/cache");
    const { planPipeline } = await import("@/lib/pipeline/plan");
    const { listTextModels } = await import("@/lib/providers/registry");
    const { voiceDirectionKey } = await import("@/lib/pipeline/voice-direction");
    const doc = emptyDoc();
    doc.settings.voice = { ...doc.settings.voice, model: "qwen-audio-3.0-tts-flash", voiceId: "longanhuan_v3.6" };
    doc.segments = [{ title: "开场", text: "一句测试文案。" }];
    doc.lines = [{ id: "line-1", segmentIndex: 0, text: "一句测试文案。", spans: [], keywords: [], locked: true }];
    const project = createProject(doc);
    const goal = { until: "preview" as const, aspects: ["16:9" as const], quality: "draft" as const };
    const planned = planPipeline(project.id, doc, goal);
    expect(planned.steps.map((step) => step.stage)).toContain("voice-direction");
    expect(planned.steps.some((step) => step.stage === "tts" || step.stage === "tts-block")).toBe(false);
    expect(planned.currentKeys.some((key) => key.startsWith("voice-direction:"))).toBe(true);

    const filled = { ...doc, settings: { ...doc.settings, voice: { ...doc.settings.voice, instruction: "沉稳、老练。" } } };
    expect(planPipeline(project.id, filled, goal).steps.some((step) => step.stage === "voice-direction")).toBe(false);

    const modelId = listTextModels()[0]?.id ?? "";
    cachePut(voiceDirectionKey(doc, modelId), "voice-direction", { instruction: null });
    const afterFailure = planPipeline(project.id, doc, goal);
    expect(afterFailure.steps.some((step) => step.stage === "voice-direction")).toBe(false);
    expect(afterFailure.steps.some((step) => step.stage === "tts" || step.stage === "tts-block")).toBe(true);

    const cosy = { ...doc, settings: { ...doc.settings, voice: { ...emptyDoc().settings.voice } } };
    expect(planPipeline(project.id, cosy, goal).steps.some((step) => step.stage === "voice-direction")).toBe(false);
  });

  it("仍有前置条件时保留已暂停的目标", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { drive, getGoal } = await import("@/lib/pipeline/plan");
    const project = createProject();
    drive(project.id, { until: "render", aspects: ["16:9"], quality: "final" });
    expect(getGoal(project.id)?.blocked).toBe("还没有文案");
  });
});
