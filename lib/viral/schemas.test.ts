import { describe, expect, it } from "vitest";
import { viralCommandSchema, viralDraftSchema, viralGenerationContextSchema, viralInputSchema, viralOutlineSchema, viralScriptVersionSchema } from "./schemas";
import { createEmptyDraft, defaultViralInput, snapshotDraft } from "./state";
import type { ViralGenerationContext, ViralScriptVersion } from "./types";

describe("复创序列化与请求边界", () => {
  it("停止必须指向用户明确选择的任务，不能仅凭草稿版本停止任意当前任务", () => {
    expect(viralCommandSchema.safeParse({ expectedRevision: 0, command: "stop" }).success).toBe(false);
    expect(viralCommandSchema.safeParse({ expectedRevision: 0, command: "stop", expectedTaskId: "" }).success).toBe(false);
    expect(viralCommandSchema.safeParse({ expectedRevision: 0, command: "stop", expectedTaskId: " " }).success).toBe(false);
    expect(viralCommandSchema.parse({ expectedRevision: 0, command: "stop", expectedTaskId: "clicked-task" })).toEqual({ expectedRevision: 0, command: "stop", expectedTaskId: "clicked-task" });
    expect(viralCommandSchema.safeParse({ expectedRevision: 0, command: "resume" }).success).toBe(true);
  });
  it("保存允许尚未填齐的输入，保留原始空格，拒绝超限而不截断", () => {
    const input = defaultViralInput();
    input.referenceText = "  原文\n保留格式  ";
    expect(viralInputSchema.parse(input).referenceText).toBe(input.referenceText);
    input.referenceText = "字".repeat(20_001);
    expect(viralInputSchema.safeParse(input).success).toBe(false);
    expect(input.referenceText.length).toBe(20_001);
    input.referenceText = "字".repeat(20_000);
    input.materials = [{ id: "m1", text: "字".repeat(6_000), kind: "fact", source: "用户", verification: "user_provided" }, { id: "m2", text: "字".repeat(4_001), kind: "data", source: "出处", verification: "pending" }];
    expect(viralInputSchema.safeParse(input).success).toBe(false);
  });
  it("引用不存在的当前版本或角度不能成为合法持久草稿", () => {
    const draft = createEmptyDraft(defaultViralInput(), "quick", "draft1", "2026-10-11T00:00:00Z");
    expect(viralDraftSchema.safeParse(JSON.parse(JSON.stringify(draft))).success).toBe(true);
    expect(viralDraftSchema.safeParse({ ...draft, currentVersionId: "lost" }).success).toBe(false);
    expect(viralDraftSchema.safeParse({ ...draft, selectedAngleId: "lost" }).success).toBe(false);
  });
  it("生成 DTO 严格禁止加入原文、逐句分析或独特表达", () => {
    const input = defaultViralInput();
    const context: ViralGenerationContext = { mechanisms: [], task: { topic: input.topic, platform: input.platform, targetSeconds: input.targetSeconds, audience: input.audience, coreClaim: input.coreClaim, contentKind: input.contentKind, perspective: input.perspective, rate: input.rate, mustInclude: input.mustInclude, avoid: input.avoid, ending: input.ending, memes: input.memes, humanize: input.humanize }, style: input.style, materials: [], selectedAngle: null, outline: null };
    expect(viralGenerationContextSchema.safeParse(context).success).toBe(true);
    for (const key of ["referenceText", "observations", "distinctiveElements"]) expect(viralGenerationContextSchema.safeParse({ ...context, [key]: "不应进入生成" }).success).toBe(false);
    expect(viralGenerationContextSchema.safeParse({ ...context, task: { ...context.task, referenceText: "不得嵌入任务" } }).success).toBe(false);
  });
  it("完整标记不能让半稿通过，段落完成列表必须准确", () => {
    const version: ViralScriptVersion = { id: "v1", revision: 1, title: "标题", segments: [{ id: "s1", title: "", text: "正文", materialIds: [] }], completedSegmentIds: [], complete: false, manuallyEdited: false, basedOn: snapshotDraft(createEmptyDraft()), createdAt: "", parentVersionId: null, origin: "generated" };
    expect(viralScriptVersionSchema.safeParse(version).success).toBe(true);
    expect(viralScriptVersionSchema.safeParse({ ...version, complete: true }).success).toBe(false);
    expect(viralScriptVersionSchema.safeParse({ ...version, complete: true, completedSegmentIds: ["s1"] }).success).toBe(true);
    expect(viralScriptVersionSchema.safeParse({ ...version, completedSegmentIds: ["absent"] }).success).toBe(false);
  });
  it("大纲至少一段且段落时长为正，局部重写需指定目标与要求", () => {
    expect(viralOutlineSchema.safeParse({ id: "o1", sections: [], sourceFingerprint: "", createdAt: "" }).success).toBe(false);
    expect(viralOutlineSchema.safeParse({ id: "o1", sections: [{ id: "s1", title: "", function: "", points: [], seconds: 0, materialIds: [] }], sourceFingerprint: "", createdAt: "" }).success).toBe(false);
    expect(viralCommandSchema.safeParse({ expectedRevision: 0, command: "rewrite" }).success).toBe(false);
    expect(viralCommandSchema.safeParse({ expectedRevision: 0, command: "rewrite", rewrite: { segmentId: "s1", instruction: "更简洁" } }).success).toBe(true);
  });
});
