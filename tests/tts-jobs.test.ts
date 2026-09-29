import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lineSpeech, ttsKey } from "@/lib/core/keys";
import { emptyDoc } from "@/lib/core/types";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-tts-jobs-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function project() {
  const { createProject } = await import("@/lib/server/projects");
  const doc = emptyDoc();
  const texts = ["第一句测试。", "第二句测试。"];
  doc.segments = [{ title: "测试", text: texts.join("") }];
  doc.lines = texts.map((text, index) => ({ id: `line-${index}`, segmentIndex: 0, text, spans: [], keywords: [], locked: true }));
  return createProject(doc);
}

describe("配音任务统一构造", () => {
  it("逐句模式：任务键与单句缓存键一致，输入字段完整", async () => {
    const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
    const { ttsSteps } = await import("@/lib/pipeline/tts-jobs");
    const p = await project();
    const steps = ttsSteps(p.doc, p.id, lineTtsKeys(p.doc, p.id));
    expect(steps).toHaveLength(2);
    const speech = lineSpeech(p.doc.lines[1], []);
    expect(steps[1]).toMatchObject({
      stage: "tts",
      key: ttsKey(speech.spoken, p.doc.settings.voice),
      target: "第 2 句",
      priority: 4,
      input: { projectId: p.id, lineId: "line-1", text: "第二句测试。", spoken: speech.spoken, ttsText: speech.spoken, map: speech.map, voice: p.doc.settings.voice },
    });
    expect(steps[1].cost).toBeGreaterThan(0);
    expect((steps[1].input as { force?: boolean }).force).toBeUndefined();
  });

  it("重录带 force；换音色用目标音色和键前缀", async () => {
    const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
    const { ttsSteps } = await import("@/lib/pipeline/tts-jobs");
    const p = await project();
    const voice = { ...p.doc.settings.voice, voiceId: "other" };
    const [forced] = ttsSteps(p.doc, p.id, lineTtsKeys(p.doc, p.id).slice(0, 1), { force: true });
    expect((forced.input as { force?: boolean }).force).toBe(true);
    const items = lineTtsKeys({ ...p.doc, settings: { ...p.doc.settings, voice } }, p.id);
    const [changed] = ttsSteps(p.doc, p.id, items, { voice, keyPrefix: "voice-change:x:" });
    expect(changed.key).toBe(`voice-change:x:${items[0].key}`);
    expect((changed.input as { voice: { voiceId: string } }).voice.voiceId).toBe("other");
  });

  it("replace 取消同键的旧任务再排队；不 replace 时复用排队中的任务", async () => {
    const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
    const { enqueueTtsSteps, ttsSteps } = await import("@/lib/pipeline/tts-jobs");
    const { getJob } = await import("@/lib/server/jobs");
    const p = await project();
    const steps = ttsSteps(p.doc, p.id, lineTtsKeys(p.doc, p.id).slice(0, 1));
    const [first] = enqueueTtsSteps(p.id, steps);
    expect(enqueueTtsSteps(p.id, steps)[0].id).toBe(first.id);
    const [second] = enqueueTtsSteps(p.id, steps, { replace: true });
    expect(second.id).not.toBe(first.id);
    expect(getJob(first.id)?.status).toBe("canceled");
  });
});
