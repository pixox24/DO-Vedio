import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PermanentError } from "@/lib/pipeline/stage";
import { addCustomVoice, deleteCustomVoice, listCustomVoices, noteCustomVoiceProbe, probeNoteForOutcome, VoiceBookError } from "@/lib/server/custom-voices";

const dir = mkdtempSync(path.join(tmpdir(), "dovedio-voices-"));
const original = {
  key: process.env.DASHSCOPE_API_KEY,
  http: process.env.DASHSCOPE_TTS_HTTP_URL,
  workspace: process.env.DASHSCOPE_WORKSPACE_ID,
};

beforeAll(() => {
  process.env.DATA_DIR = dir;
  process.env.DASHSCOPE_API_KEY = "test-key";
  delete process.env.DASHSCOPE_TTS_HTTP_URL;
  delete process.env.DASHSCOPE_WORKSPACE_ID;
});

beforeEach(async () => {
  const { run } = await import("@/lib/server/db");
  run("DELETE FROM custom_voices");
});

afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  if (original.key == null) delete process.env.DASHSCOPE_API_KEY;
  else process.env.DASHSCOPE_API_KEY = original.key;
  if (original.http == null) delete process.env.DASHSCOPE_TTS_HTTP_URL;
  else process.env.DASHSCOPE_TTS_HTTP_URL = original.http;
  if (original.workspace == null) delete process.env.DASHSCOPE_WORKSPACE_ID;
  else process.env.DASHSCOPE_WORKSPACE_ID = original.workspace;
});

describe("自定义音色册", () => {
  it("按模型保存，并出现在该模型的音色接口里", async () => {
    const voice = addCustomVoice({ provider: "dashscope", model: "cosyvoice-v3-flash", voiceId: "longanhuan_v3", name: " 龙安欢 V3 " });
    expect(voice.name).toBe("龙安欢 V3");
    expect(listCustomVoices().map((item) => item.voiceId)).toEqual(["longanhuan_v3"]);

    const { GET } = await import("@/app/api/voices/route");
    const body = await (await GET()).json();
    const flash = body.providers[0].models.find((model: { id: string }) => model.id === "cosyvoice-v3-flash");
    const added = flash.voices.find((item: { id: string }) => item.id === "longanhuan_v3");
    expect(added).toMatchObject({ name: "龙安欢 V3", customId: voice.id, probe: "unknown", style: "自定义 · 未试听" });
    expect(flash.voices.some((item: { id: string; customId?: string }) => item.id === "longanyang" && !item.customId)).toBe(true);
    const plus = body.providers[0].models.find((model: { id: string }) => model.id === "cosyvoice-v3-plus");
    expect(plus.voices.some((item: { id: string }) => item.id === "longanhuan_v3")).toBe(false);
  });

  it("拒绝预置音色、重复项、别的服务商和未配置的 Qwen", () => {
    expect(() => addCustomVoice({ provider: "dashscope", model: "cosyvoice-v3-flash", voiceId: "longanyang" })).toThrow(VoiceBookError);
    expect(() => addCustomVoice({ provider: "google-gemini", model: "cosyvoice-v3-flash", voiceId: "Kore" })).toThrow(/百炼/);
    expect(() => addCustomVoice({ provider: "dashscope", model: "not-a-model", voiceId: "longanhuan_v3" })).toThrow(/未知/);
    expect(() => addCustomVoice({ provider: "dashscope", model: "qwen-audio-3.0-tts-plus", voiceId: "longanhuan_v3" })).toThrow(/Qwen TTS HTTP/);
    addCustomVoice({ provider: "dashscope", model: "cosyvoice-v3-plus", voiceId: "longanhuan" });
    expect(() => addCustomVoice({ provider: "dashscope", model: "cosyvoice-v3-plus", voiceId: "longanhuan" })).toThrow(/已经添加过/);
    expect(() => addCustomVoice({ provider: "dashscope", model: "cosyvoice-v3-flash", voiceId: "龙安欢" })).toThrow(VoiceBookError);
  });

  it("没有 API Key 时不能添加", () => {
    delete process.env.DASHSCOPE_API_KEY;
    try {
      expect(() => addCustomVoice({ provider: "dashscope", model: "cosyvoice-v3-flash", voiceId: "longanhuan_v3" })).toThrow(/DASHSCOPE_API_KEY/);
    } finally {
      process.env.DASHSCOPE_API_KEY = "test-key";
    }
  });

  it("试听成功记下时间戳，参数错误标失败，网络错误不改状态", () => {
    const voice = addCustomVoice({ provider: "dashscope", model: "cosyvoice-v3-flash", voiceId: "longanhuan_v3" });
    expect(probeNoteForOutcome({ error: new Error("超时") })).toBeNull();
    expect(probeNoteForOutcome({ error: new PermanentError("语音合成失败：voice not supported") })).toMatchObject({ ok: false });
    noteCustomVoiceProbe(voice.provider, voice.model, voice.voiceId, { ok: false, error: "音色不匹配" });
    expect(listCustomVoices()[0]).toMatchObject({ probe: "failed", timestampSupport: "unknown", lastError: "音色不匹配" });
    noteCustomVoiceProbe(voice.provider, voice.model, voice.voiceId, { ok: true, timestamps: false });
    expect(listCustomVoices()[0]).toMatchObject({ probe: "ok", timestampSupport: "no", lastError: "" });
    noteCustomVoiceProbe("dashscope", "cosyvoice-v3-flash", "missing", { ok: true, timestamps: true });
    expect(listCustomVoices()).toHaveLength(1);
  });

  it("可以删除，删掉的不再出现", () => {
    const voice = addCustomVoice({ provider: "dashscope", model: "cosyvoice-v3-flash", voiceId: "longanhuan_v3" });
    expect(deleteCustomVoice(voice.id)).toBe(true);
    expect(deleteCustomVoice(voice.id)).toBe(false);
    expect(listCustomVoices()).toEqual([]);
  });
});
