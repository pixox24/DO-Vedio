import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDoc } from "@/lib/core/types";
import { lineTtsKeys } from "@/lib/pipeline/artifacts";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-voice-change-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const audio = { assetId: "test", durationMs: 1000, speechStartMs: 0, speechEndMs: 1000, chars: [], aligned: false, spokenChars: 6 };

async function projectWithLines(voiced: boolean) {
  const { createProject } = await import("@/lib/server/projects");
  const { cachePut } = await import("@/lib/server/cache");
  const doc = emptyDoc();
  const texts = voiced ? ["第一句测试。", "第二句测试。"] : ["这句尚未配音。", "另句尚未配音。"];
  doc.segments = [{ title: "测试", text: texts.join("") }];
  doc.lines = texts.map((text, index) => ({ id: `line-${index}`, segmentIndex: 0, text, spans: [], keywords: [], locked: true }));
  const project = createProject(doc);
  if (voiced) for (const item of lineTtsKeys(doc, project.id)) cachePut(item.key, "tts", audio);
  return project;
}

describe("配音设置分批应用", () => {
  it("生成期间沿用旧配音，全部就绪后一次切换且可撤回", async () => {
    const { getProject } = await import("@/lib/server/projects");
    const { cachePut } = await import("@/lib/server/cache");
    const { applyVoiceChange, finalizeVoiceChange, getVoiceChange, quoteVoiceChange, revertVoiceChange } = await import("@/lib/server/voice-change");
    const project = await projectWithLines(true);
    const next = { ...project.doc.settings.voice, voiceId: "new-voice" };
    expect(quoteVoiceChange(project.id, next)).toMatchObject({ existing: 2, affected: 2, reusable: 0, generate: 2 });
    expect(applyVoiceChange(project.id, next)).toMatchObject({ status: "pending", ready: 0, total: 2 });
    expect(getProject(project.id)?.doc.settings.voice.voiceId).toBe(project.doc.settings.voice.voiceId);
    const target = lineTtsKeys({ ...project.doc, settings: { ...project.doc.settings, voice: next } }, project.id);
    cachePut(target[0].key, "tts", audio);
    expect(finalizeVoiceChange(project.id)).toBe(false);
    expect(getVoiceChange(project.id)).toMatchObject({ status: "pending", ready: 1 });
    cachePut(target[1].key, "tts", audio);
    expect(finalizeVoiceChange(project.id)).toBe(true);
    expect(getProject(project.id)?.doc.settings.voice.voiceId).toBe("new-voice");
    expect(getVoiceChange(project.id)).toMatchObject({ status: "applied", revertible: true });
    revertVoiceChange(project.id);
    expect(getProject(project.id)?.doc.settings.voice.voiceId).toBe(project.doc.settings.voice.voiceId);
  });

  it("取消只停止待应用任务，保留原配音", async () => {
    const { getProject } = await import("@/lib/server/projects");
    const { all } = await import("@/lib/server/db");
    const { applyVoiceChange, cancelVoiceChange, getVoiceChange } = await import("@/lib/server/voice-change");
    const project = await projectWithLines(true);
    applyVoiceChange(project.id, { ...project.doc.settings.voice, rate: 1.2 });
    cancelVoiceChange(project.id);
    expect(getVoiceChange(project.id)).toBeNull();
    expect(getProject(project.id)?.doc.settings.voice.rate).toBe(1);
    expect(all<{ status: string }>("SELECT status FROM jobs WHERE project_id = ?", project.id).every((job) => job.status === "canceled")).toBe(true);
  });

  it("尚无配音时只保存设置，不创建合成任务", async () => {
    const { getProject } = await import("@/lib/server/projects");
    const { all } = await import("@/lib/server/db");
    const { applyVoiceChange } = await import("@/lib/server/voice-change");
    const project = await projectWithLines(false);
    expect(applyVoiceChange(project.id, { ...project.doc.settings.voice, volume: 60 })).toMatchObject({ status: "applied" });
    expect(getProject(project.id)?.doc.settings.voice.volume).toBe(60);
    expect(all("SELECT id FROM jobs WHERE project_id = ?", project.id)).toHaveLength(0);
  });
});
