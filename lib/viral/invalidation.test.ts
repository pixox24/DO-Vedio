import { describe, expect, it } from "vitest";
import { angleContextCompatible, anglesSourceFingerprint, getInvalidation, snapshotDraft } from "./invalidation";
import { createEmptyDraft, defaultViralInput } from "./state";
import type { ViralInputSnapshot } from "./types";

function snapshot(): ViralInputSnapshot { return snapshotDraft(createEmptyDraft(defaultViralInput())); }
describe("阶段失效而不删除旧产物", () => {
  it("重新构思仅平台/时长适配保留选择；主题、参考与素材改变采用新角度", () => {
    const previous = snapshot(); previous.input.topic = "咖啡";
    const source = anglesSourceFingerprint(previous);
    const adaptation = structuredClone(previous); adaptation.input.platform = "bilibili"; adaptation.input.targetSeconds = 300;
    expect(angleContextCompatible(source, adaptation)).toBe(true);
    for (const edit of [(s: ViralInputSnapshot) => { s.input.topic = "AI字幕"; }, (s: ViralInputSnapshot) => { s.input.referenceText = "新的参考"; }, (s: ViralInputSnapshot) => { s.input.materials.push({ id: "new", text: "新资料", kind: "fact", source: "用户提供", verification: "user_provided" }); }]) {
      const changed = structuredClone(previous); edit(changed);
      expect(angleContextCompatible(source, changed)).toBe(false);
    }
    expect(angleContextCompatible(null, previous)).toBe(false);
  });
  it.each([
    ["参考稿", "analysis", (s: ViralInputSnapshot) => { s.input.referenceText = "新原文"; }],
    ["主题", "angles", (s: ViralInputSnapshot) => { s.input.topic = "新主题"; }],
    ["平台", "angles", (s: ViralInputSnapshot) => { s.input.platform = "bilibili"; }],
    ["目标时长", "angles", (s: ViralInputSnapshot) => { s.input.targetSeconds = 300; }],
    ["风格", "generation", (s: ViralInputSnapshot) => { s.input.style.tone = "新的语气"; }],
    ["视角", "generation", (s: ViralInputSnapshot) => { s.input.perspective = "first"; }],
    ["语速", "outline", (s: ViralInputSnapshot) => { s.input.rate = "fast"; }],
    ["禁用词", "review", (s: ViralInputSnapshot) => { s.input.avoid = ["赋能"]; }],
  ] as const)("%s 修改从 %s 更新", (_, expected, change) => {
    const before = snapshot(); const next = structuredClone(before); change(next);
    expect(getInvalidation(before, next).earliestStage).toBe(expected);
  });
  it("论证路线与大纲按各自最早阶段失效", () => {
    const before = snapshot(); const next = structuredClone(before);
    next.selectedAngle = { id: "a1", title: "角度", coreQuestion: "问题", coreClaim: "论点", hook: "开头", route: [{ id: "e1", claim: "依据", materialIds: [] }], materialIds: [], missingEvidence: [], recommendedReason: "" };
    expect(getInvalidation(before, next).earliestStage).toBe("outline");
    const outlineNext = structuredClone(next);
    outlineNext.outline = { id: "o1", sections: [{ id: "s1", title: "引入", function: "提出问题", points: ["观点"], seconds: 30, materialIds: [] }], sourceFingerprint: "", createdAt: "" };
    expect(getInvalidation(next, outlineNext).earliestStage).toBe("generation");
  });
  it("画幅、模型及默认/手动标记不使正文过期", () => {
    const before = snapshot(); const next = structuredClone(before);
    next.input.handoff = { aspectRatio: "16:9", aspectRatioIsManual: true, settingsVersion: 99 };
    next.input.modelId = "用户模型"; next.input.durationIsManual = true;
    const invalidation = getInvalidation(before, next);
    expect(invalidation.earliestStage).toBeNull();
    expect(invalidation.handoffChanged).toBe(true); expect(invalidation.modelChanged).toBe(true);
  });
  it("风格显式选择后才采用新快照，修改外部对象不影响原快照", () => {
    const before = snapshot(); const next = structuredClone(before);
    next.input.style.rules.push("每段不超过三行");
    expect(before.input.style.rules).toEqual([]);
    expect(getInvalidation(before, next).earliestStage).toBe("generation");
  });
});
