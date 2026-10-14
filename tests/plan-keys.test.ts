import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyDoc, voiceSettingsSchema } from "@/lib/core/types";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-plan-keys-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("计划中的段落配音任务键", () => {
  it("同一目标切换画面管线使用新分镜键，无关设置保持键稳定", async () => {
    const registry = await import("@/lib/providers/registry");
    const models = vi.spyOn(registry, "listTextModels").mockReturnValue([{ id: "test-text" } as ReturnType<typeof registry.listTextModels>[number]]);
    try {
      const { createProject, mutateProject } = await import("@/lib/server/projects");
      const { cachePut } = await import("@/lib/server/cache");
      const { castSourceHash } = await import("@/lib/core/cast");
      const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
      const { produce } = await import("@/lib/pipeline/plan");
      const { run } = await import("@/lib/server/db");
      const doc = emptyDoc();
      doc.settings.modelId = "test-text";
      doc.settings.voice.instruction = "自然口播";
      doc.segments = [{ title: "开场", text: "同一段旁白。" }];
      doc.lines = [{ id: "line-switch", segmentIndex: 0, text: "同一段旁白。", spans: [], keywords: [], locked: true }];
      doc.castAnalysis = { sourceHash: castSourceHash(doc), modes: [], skipped: [], issues: [] };
      const project = createProject(doc);
      for (const item of lineTtsKeys(doc, project.id)) {
        cachePut(item.key, "tts", { assetId: "test", speechStartMs: 0, speechEndMs: 1000, durationMs: 1000, chars: [], aligned: false, spokenChars: item.spoken.length });
      }
      const goal = { until: "compose" as const, aspects: ["16:9" as const], quality: "draft" as const };
      const opts = { goalId: "same-goal", confirmBudget: true };
      const image = produce(project.id, goal, opts);
      const imageJob = image.enqueued.find((job) => job.stage === "storyboard")!;
      expect(imageJob).toBeDefined();
      expect(image.plan.currentKeys).toContain(imageJob.key);
      expect(produce(project.id, goal, opts).enqueued.find((job) => job.stage === "storyboard")?.id).toBe(imageJob.id);
      run("UPDATE jobs SET status = 'succeeded' WHERE id = ?", imageJob.id);
      mutateProject(project.id, (current) => ({ ...current, settings: { ...current.settings, visualPipeline: "video" } }));
      const video = produce(project.id, goal, opts);
      const videoJob = video.enqueued.find((job) => job.stage === "storyboard")!;
      expect(videoJob).toBeDefined();
      expect(videoJob.key).not.toBe(imageJob.key);
      expect(videoJob.key).toMatch(/:goal:same-goal$/);
      expect(video.plan.currentKeys).toContain(videoJob.key);
      expect(video.plan.currentKeys).not.toContain(imageJob.key);
      expect(videoJob.id).not.toBe(imageJob.id);
      mutateProject(project.id, (current) => ({ ...current, settings: { ...current.settings, budgetYuan: 999 } }));
      const stable = produce(project.id, { ...goal, quality: "final" }, { ...opts, dryRun: true });
      expect(stable.plan.steps.find((step) => step.stage === "storyboard")?.key).toBe(videoJob.key);
      mutateProject(project.id, (current) => ({ ...current, settings: { ...current.settings, visualPipeline: "image" } }));
      expect(produce(project.id, goal, { ...opts, dryRun: true }).plan.steps.find((step) => step.stage === "storyboard")?.key).toBe(imageJob.key);
    } finally {
      models.mockRestore();
    }
  });

  it("currentKeys 使用块键且文案改动不会改变任务数量", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { planPipeline } = await import("@/lib/pipeline/plan");
    const doc = emptyDoc();
    doc.settings.voice = voiceSettingsSchema.parse({ granularity: "paragraph" });
    doc.segments = [{ title: "段落", text: "第一句。第二句。第三句。" }];
    doc.lines = ["第一句。", "第二句。", "第三句。"].map((text, index) => ({ id: `line-${index}`, segmentIndex: 0, text, spans: [], keywords: [], locked: true }));
    const project = createProject(doc);
    const goal = { until: "preview" as const, aspects: ["16:9" as const], quality: "draft" as const };
    const first = planPipeline(project.id, doc, goal);
    const ttsKeys = first.currentKeys.filter((key) => key.startsWith("tts"));
    expect(ttsKeys).toHaveLength(1);
    expect(ttsKeys[0]).toMatch(/^tts-block:/);
    const changedText = "第一句。改过的第二句。第三句。";
    const changed = { ...doc, segments: [{ ...doc.segments[0], text: changedText }], lines: doc.lines.map((line, index) => index === 1 ? { ...line, text: "改过的第二句。" } : line) };
    const second = planPipeline(project.id, changed, goal);
    expect(second.currentKeys.filter((key) => key.startsWith("tts"))).toHaveLength(ttsKeys.length);
    expect(second.currentKeys.some((key) => key === ttsKeys[0])).toBe(false);
  });

  it("只读计划带上和入队相同的目标后缀", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { produce } = await import("@/lib/pipeline/plan");
    const doc = emptyDoc();
    doc.segments = [{ title: "段落", text: "第一句。" }];
    doc.lines = [{ id: "line-0", segmentIndex: 0, text: "第一句。", spans: [], keywords: [], locked: true }];
    const project = createProject(doc);
    const goal = { until: "preview" as const, aspects: ["16:9" as const], quality: "draft" as const };
    const dry = produce(project.id, goal, { dryRun: true, goalId: "goal-1" });
    expect(dry.enqueued).toHaveLength(0);
    expect(dry.plan.currentKeys.length).toBeGreaterThan(0);
    expect(dry.plan.currentKeys.every((key) => key.endsWith(":goal:goal-1"))).toBe(true);
    expect(dry.plan.steps.every((step) => step.key.endsWith(":goal:goal-1"))).toBe(true);
    const live = produce(project.id, goal, { goalId: "goal-1", confirmBudget: true });
    expect(live.plan.currentKeys).toEqual(dry.plan.currentKeys);
    expect(live.enqueued.length).toBeGreaterThan(0);
    expect(live.enqueued.every((job) => dry.plan.currentKeys.includes(job.key))).toBe(true);
  });

  it("渲染计划键与入队键都使用时间轴哈希", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { cachePut } = await import("@/lib/server/cache");
    const { castSourceHash } = await import("@/lib/core/cast");
    const { blankShot, stampShots } = await import("@/lib/core/shots");
    const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
    const { planPipeline } = await import("@/lib/pipeline/plan");
    const doc = emptyDoc();
    doc.segments = [{ title: "开场", text: "一句已经配好的文案。" }];
    doc.lines = [{ id: "line-0", segmentIndex: 0, text: "一句已经配好的文案。", spans: [], keywords: [], locked: true }];
    doc.shots = stampShots([blankShot("shot-1", "line-0")], doc.lines);
    doc.castAnalysis = { sourceHash: castSourceHash(doc), modes: [], skipped: [], issues: [] };
    const project = createProject(doc);
    for (const item of lineTtsKeys(doc, project.id)) {
      cachePut(item.key, "tts", { assetId: "test", speechStartMs: 0, speechEndMs: 1000, durationMs: 1000, chars: [], aligned: false, spokenChars: item.spoken.length });
    }
    const plan = planPipeline(project.id, doc, { until: "render", aspects: ["16:9"], quality: "final" });
    const renderSteps = plan.steps.filter((step) => step.stage === "render").map((step) => step.key);
    const renderKeys = plan.currentKeys.filter((key) => key.startsWith("render:"));
    expect(renderSteps).toHaveLength(1);
    expect(renderKeys).toEqual(renderSteps);
  });

  it("只有 3 秒的旧成片不会挡住按输出规格重渲", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { cachePut } = await import("@/lib/server/cache");
    const { castSourceHash } = await import("@/lib/core/cast");
    const { RENDER_OUTPUT_VERSION } = await import("@/lib/core/keys");
    const { blankShot, stampShots } = await import("@/lib/core/shots");
    const { animationHash, contentHash, timelineHash } = await import("@/lib/core/timeline");
    const { lineTtsKeys, timelineFor } = await import("@/lib/pipeline/artifacts");
    const { planPipeline } = await import("@/lib/pipeline/plan");
    const { run } = await import("@/lib/server/db");
    const doc = emptyDoc();
    doc.segments = [{ title: "开场", text: "一句已经配好的文案。" }];
    doc.lines = [{ id: "line-0", segmentIndex: 0, text: "一句已经配好的文案。", spans: [], keywords: [], locked: true }];
    doc.shots = stampShots([blankShot("shot-1", "line-0")], doc.lines);
    doc.castAnalysis = { sourceHash: castSourceHash(doc), modes: [], skipped: [], issues: [] };
    const project = createProject(doc);
    for (const item of lineTtsKeys(doc, project.id)) {
      cachePut(item.key, "tts", { assetId: "test", speechStartMs: 0, speechEndMs: 1000, durationMs: 1000, chars: [], aligned: false, spokenChars: item.spoken.length });
    }
    const goal = { until: "render" as const, aspects: ["16:9" as const], quality: "draft" as const };
    const timeline = timelineFor(doc, project.id, "landscape-1080p");
    const hash = contentHash(timeline);
    const fullHash = timelineHash(timeline);
    const motionHash = animationHash(timeline);
    run(
      "INSERT INTO renders (id, project_id, aspect, quality, timeline_hash, content_hash, animation_hash, video_hash, duration_ms, created_at, output_version) VALUES (?, ?, '16:9', 'draft', ?, ?, '', 'old', 1000, ?, 0)",
      "old-render",
      project.id,
      fullHash,
      hash,
      Date.now(),
    );
    expect(planPipeline(project.id, doc, goal).steps.some((step) => step.stage === "render")).toBe(true);
    run("UPDATE renders SET output_version = ? WHERE id = ?", RENDER_OUTPUT_VERSION, "old-render");
    expect(planPipeline(project.id, doc, goal).steps.some((step) => step.stage === "render")).toBe(false);
    run("UPDATE renders SET animation_hash = ? WHERE id = ?", "changed-motion", "old-render");
    expect(planPipeline(project.id, doc, goal).steps.some((step) => step.stage === "render")).toBe(true);
    run("UPDATE renders SET animation_hash = ? WHERE id = ?", motionHash, "old-render");
    expect(planPipeline(project.id, doc, goal).steps.some((step) => step.stage === "render")).toBe(false);
    expect(planPipeline(project.id, doc, { ...goal, forceRender: true }).steps.some((step) => step.stage === "render")).toBe(true);
  });

  it("确认开工不排渲染，生成成片沿用同一个目标", async () => {
    const { createProject } = await import("@/lib/server/projects");
    const { drive, getGoal, planPipeline } = await import("@/lib/pipeline/plan");
    const doc = emptyDoc();
    doc.segments = [{ title: "开场", text: "还没有配音。" }];
    doc.lines = [{ id: "line-0", segmentIndex: 0, text: "还没有配音。", spans: [], keywords: [], locked: true }];
    const project = createProject(doc);
    const composePlan = planPipeline(project.id, doc, { until: "compose", aspects: ["16:9"], quality: "final" });
    expect(composePlan.steps.some((step) => step.stage === "render")).toBe(false);
    expect(composePlan.currentKeys.some((key) => key.startsWith("render:"))).toBe(false);
    expect(composePlan.ready.render).toBe(false);
    const started = drive(project.id, { until: "compose", aspects: ["16:9"], quality: "final" });
    expect(started.enqueued.some((job) => job.stage === "render")).toBe(false);
    expect(started.enqueued.length).toBeGreaterThan(0);
    const goalId = getGoal(project.id)?.goal.goalId;
    expect(getGoal(project.id)?.goal.until).toBe("compose");
    const render = drive(project.id, { until: "render", aspects: ["16:9"], quality: "final" });
    expect(getGoal(project.id)?.goal.goalId).toBe(goalId);
    expect(getGoal(project.id)?.goal.until).toBe("render");
    expect(render.enqueued.some((job) => job.stage === "render")).toBe(false);
  });
});
