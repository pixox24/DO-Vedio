import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
});
