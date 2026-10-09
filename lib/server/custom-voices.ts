import { randomUUID } from "crypto";
import { voiceNameError, voiceParamError } from "../core/voice-book";
import { dashscopeModelState, dashscopeTts } from "../providers/tts/dashscope";
import { PermanentError } from "../pipeline/stage";
import { get, run, all } from "./db";

export type CustomVoice = {
  id: string;
  provider: string;
  model: string;
  voiceId: string;
  name: string;
  probe: "unknown" | "ok" | "failed";
  timestampSupport: "unknown" | "yes" | "no";
  lastError: string;
  createdAt: number;
};

type Row = {
  id: string;
  provider: string;
  model: string;
  voice_id: string;
  name: string;
  probe: CustomVoice["probe"];
  timestamp_support: CustomVoice["timestampSupport"];
  last_error: string;
  created_at: number;
};

export class VoiceBookError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function fromRow(row: Row): CustomVoice {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    voiceId: row.voice_id,
    name: row.name,
    probe: row.probe,
    timestampSupport: row.timestamp_support,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

export function listCustomVoices(): CustomVoice[] {
  return all<Row>("SELECT * FROM custom_voices ORDER BY created_at ASC, voice_id ASC").map(fromRow);
}

export function addCustomVoice(input: { provider: string; model: string; voiceId: string; name?: string }): CustomVoice {
  if (input.provider !== "dashscope") throw new VoiceBookError("只能为阿里云百炼的语音模型添加音色");
  const voiceId = input.voiceId.trim();
  const name = (input.name ?? "").trim();
  const paramError = voiceParamError(voiceId);
  if (paramError) throw new VoiceBookError(paramError);
  const nameError = voiceNameError(name);
  if (nameError) throw new VoiceBookError(nameError);
  const model = input.model.trim();
  const state = dashscopeModelState(model);
  if (!state.known) throw new VoiceBookError("未知的语音模型");
  if (!state.configured) throw new VoiceBookError(state.hint ?? "这个模型还不能合成");
  if (dashscopeTts().voices(model).some((voice) => voice.id === voiceId)) throw new VoiceBookError("这个音色已经在预置列表里", 409);
  const existing = get<Row>("SELECT * FROM custom_voices WHERE provider = ? AND model = ? AND voice_id = ?", "dashscope", model, voiceId);
  if (existing) throw new VoiceBookError("这个模型下已经添加过该音色", 409);
  const id = randomUUID();
  const createdAt = Date.now();
  run(
    "INSERT INTO custom_voices (id, provider, model, voice_id, name, probe, timestamp_support, last_error, created_at) VALUES (?, 'dashscope', ?, ?, ?, 'unknown', 'unknown', '', ?)",
    id,
    model,
    voiceId,
    name,
    createdAt,
  );
  return { id, provider: "dashscope", model, voiceId, name, probe: "unknown", timestampSupport: "unknown", lastError: "", createdAt };
}

export function deleteCustomVoice(id: string) {
  return run("DELETE FROM custom_voices WHERE id = ?", id).changes > 0;
}

/** 试听或正式合成之后记下结果。没有对应的自定义音色时什么都不做。 */
export function noteCustomVoiceProbe(provider: string, model: string, voiceId: string, update: { ok: true; timestamps: boolean } | { ok: false; error: string }) {
  const row = get<Row>("SELECT * FROM custom_voices WHERE provider = ? AND model = ? AND voice_id = ?", provider, model, voiceId);
  if (!row) return;
  if (update.ok) {
    run("UPDATE custom_voices SET probe = 'ok', timestamp_support = ?, last_error = '' WHERE id = ?", update.timestamps ? "yes" : "no", row.id);
    return;
  }
  run("UPDATE custom_voices SET probe = 'failed', last_error = ? WHERE id = ?", update.error.slice(0, 200), row.id);
}

/**
 * 只有参数类的永久失败才记入音色册。超时和网络错误留着下次再试，不把音色标成不可用。
 * 成功时用有没有字级时间戳区分字幕对齐方式。
 */
export function probeNoteForOutcome(outcome: { words: number } | { error: unknown }): { ok: true; timestamps: boolean } | { ok: false; error: string } | null {
  if ("error" in outcome) {
    return outcome.error instanceof PermanentError ? { ok: false, error: outcome.error.message } : null;
  }
  return { ok: true, timestamps: outcome.words > 0 };
}

/** 音色册写失败不能反过来弄丢已经合成的音频。 */
export function rememberCustomVoiceProbe(provider: string, model: string, voiceId: string, outcome: Parameters<typeof probeNoteForOutcome>[0]) {
  try {
    const note = probeNoteForOutcome(outcome);
    if (note) noteCustomVoiceProbe(provider, model, voiceId, note);
  } catch (error) {
    console.error(error);
  }
}

export function catalogVoice(voice: CustomVoice) {
  const style = voice.probe === "failed"
    ? "自定义 · 试听失败"
    : voice.timestampSupport === "yes"
      ? "自定义 · 有时间戳"
      : voice.timestampSupport === "no"
        ? "自定义 · 字幕按字数估算"
        : "自定义 · 未试听";
  return {
    id: voice.voiceId,
    name: voice.name || voice.voiceId,
    gender: "custom",
    style,
    timestamps: voice.timestampSupport === "yes",
    customId: voice.id,
    probe: voice.probe,
    timestampSupport: voice.timestampSupport,
    lastError: voice.lastError,
  };
}
