import { quickHash } from "./hash";
import { mergeSpans, ruleSpans, spokenText, type LexEntry } from "./lines";
import { compileShotPrompt } from "./prompt-compiler";
import type { Line, Mood, ProjectDoc, Shot, VoiceSettings, VoiceTag } from "./types";

/**
 * 各步骤的缓存键。键 = hash(步骤名@版本 + 决定结果的全部输入)。
 * 编排层（判断要做什么）和步骤（写缓存）必须用同一套函数，所以集中放在这里。
 * 改了某步骤的算法就把版本号加 1，旧缓存自然失效。
 */

export const STAGE_VERSION = { annotate: 1, tts: 3, ttsBlock: 1, storyboard: 3, music: 1, render: 1, shotGeneration: 3, cast: 3, characterSheet: 1 } as const;

/** 标注：输入是一个段落的全部句子 */
export function annotateKey(lines: Pick<Line, "id" | "text">[], lex: LexEntry[], modelId: string) {
  return `annotate:${quickHash({ v: STAGE_VERSION.annotate, t: lines.map((l) => l.text), lex, modelId })}`;
}

/** 一句话最终的朗读文本：标注 + 词典 + 数字规则 */
export function lineSpeech(line: Pick<Line, "text" | "spans">, lex: LexEntry[]) {
  let spans = mergeSpans(line.text, line.spans, lex);
  if (spans.length === 0) spans = ruleSpans(line.text);
  else {
    // 未标注的片段仍套用数字规则
    spans = spans.flatMap((s) => (s.say === undefined ? (ruleSpans(s.text).length ? ruleSpans(s.text) : [s]) : [s]));
  }
  return { spans, ...spokenText(line.text, spans) };
}

const moodVoiceTags: Partial<Record<Mood, Exclude<VoiceTag, "auto" | "none">>> = {
  "悬疑": "serious",
  "紧张": "serious",
  "温暖": "empathetic",
  "激昂": "excited",
  "史诗": "excited",
  "忧伤": "sad",
};

export function voiceTagForLine(line: Pick<Line, "mood" | "voiceTag">) {
  if (line.voiceTag && line.voiceTag !== "auto") return line.voiceTag === "none" ? undefined : line.voiceTag;
  return line.mood ? moodVoiceTags[line.mood] : undefined;
}

function escapeXml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ssmlPauses(text: string, mode: "ssml:measured" | "ssml:compact") {
  const chars = Array.from(text);
  return `<speak>${chars.map((char, index) => {
    const hasRemainingSpeech = chars.slice(index + 1).some((next) => !/\s/.test(next) && !/[”’」』）)]/.test(next));
    if (!hasRemainingSpeech || !/[，,、：:；;—]/.test(char)) return escapeXml(char);
    const ms = mode === "ssml:measured" ? (/[；;]/.test(char) ? 450 : 280) : (/[；;]/.test(char) ? 160 : 100);
    return `${escapeXml(char)}<break time="${ms}ms"/>`;
  }).join("")}</speak>`;
}

export function ttsRequestForLine(spoken: string, line: Pick<Line, "mood" | "voiceTag">, model: string) {
  const tag = model.startsWith("qwen-audio-") ? voiceTagForLine(line) : undefined;
  if (tag === "ssml:measured" || tag === "ssml:compact") return { text: ssmlPauses(spoken, tag), textType: "SSML" as const };
  const emotionTag = tag && !tag.startsWith("ssml:") ? tag : undefined;
  return { text: emotionTag ? `[${emotionTag}]${spoken}` : spoken };
}

/** Qwen-Audio consumes control tags in text; other DashScope models receive plain speech. */
export function ttsTextForLine(spoken: string, line: Pick<Line, "mood" | "voiceTag">, model: string) {
  return ttsRequestForLine(spoken, line, model).text;
}

export function voiceKeyOf(v: VoiceSettings) {
  return `${v.provider}/${v.model}/${v.voiceId}/${quickHash({
    rate: v.rate,
    pitch: v.pitch,
    volume: v.volume,
    instruction: v.instruction,
    google: v.provider === "google-gemini" && v.google ? { ...v.google, stylePrompt: undefined } : v.google,
  })}`;
}

/** 决定音频的音色字段（逐句键与段落块键共用；合成粒度不在其中，逐句模式的旧缓存不受影响） */
function voiceFields(v: VoiceSettings, textType?: "PlainText" | "SSML") {
  return {
    p: v.provider,
    m: v.model,
    id: v.voiceId,
    r: v.rate,
    pi: v.pitch,
    vo: v.volume,
    instruction: textType === "SSML" ? "" : v.instruction,
    google: v.provider === "google-gemini" && v.google ? { ...v.google, stylePrompt: undefined } : v.google,
  };
}

/** 配音：由朗读文本和音色参数决定，与句子 ID 无关——相同文本天然复用 */
export function ttsKey(spoken: string, v: VoiceSettings, textType?: "PlainText" | "SSML") {
  return `tts:${quickHash({
    // ponytail: bump only Gemini so cached audio that spoke old style instructions cannot be reused.
    v: STAGE_VERSION.tts + (v.provider === "google-gemini" ? 1 : 0),
    s: spoken,
    ...(textType === "SSML" ? { textType } : {}),
    ...voiceFields(v, textType),
  })}`;
}

/** 段落块：块内全部朗读文本 + 连接方式 + 音色。块内任何一句变了，整块重录 */
export function ttsBlockKey(spoken: string[], joiner: string, v: VoiceSettings) {
  return `tts-block:${quickHash({ v: STAGE_VERSION.ttsBlock, s: spoken, j: joiner, ...voiceFields(v) })}`;
}

/** 块内第 index 句的配音键：同一句放在不同上下文里读法不同，所以由整块决定 */
export function ttsBlockLineKey(blockKey: string, index: number) {
  return `tts:${quickHash({ blk: blockKey, i: index })}`;
}

/** 配音任务的步骤名（逐句 / 段落块） */
export const isTtsStage = (stage: string) => stage === "tts" || stage === "tts-block";

/** 配音结果（写在 cache 里） */
export type TtsResult = {
  assetId: string;
  /** 音频总时长 */
  durationMs: number;
  /** 有效语音区间（去掉首尾静音） */
  speechStartMs: number;
  speechEndMs: number;
  /** 原文字符的时间（按原文下标；多个朗读字对应一个原文字时取并集） */
  chars: { i: number; startMs: number; endMs: number }[];
  /** 时间戳是否由服务商返回（false 表示按字数估算） */
  aligned: boolean;
  alignmentSource?: "provider" | "forced" | "estimated";
  spokenChars: number;
  /** 段落级配音：这句从哪一块切出来 */
  block?: TtsBlockInfo;
};

export type TtsBlockInfo = {
  key: string;
  index: number;
  count: number;
  /** 与块内下一句之间的自然停顿（原段落音频实测）；块尾为 0 */
  gapAfterMs: number;
  /** 切分置信度 0–1 */
  confidence: number;
  splitSource: "provider" | "vad";
  /** 整段原音频，供整段试听 */
  blockAssetId: string;
};

export function storyboardKey(input: unknown) {
  return `storyboard:${quickHash({ v: STAGE_VERSION.storyboard, input })}`;
}

export function castKey(input: unknown) {
  return `cast:${quickHash({ v: STAGE_VERSION.cast, input })}`;
}

export function musicKey(input: unknown) {
  return `music:${quickHash({ v: STAGE_VERSION.music, input })}`;
}

export function renderKey(timelineHash: string, quality: string) {
  return `render:${quickHash({ v: STAGE_VERSION.render, t: timelineHash, q: quality })}`;
}

/** 镜头生成键：编译后的提示词（内容 + 景别 + 风格 + 情绪）加上参考输入，支持单镜头精确重算。 */
export function shotGenerationKey(doc: ProjectDoc, shot: Shot, kind: "image" | "video", modelId: string) {
  const characters = doc.characters.filter((c) => shot.characterIds.includes(c.id));
  const scene = shot.sceneId ? doc.scenes.find((s) => s.id === shot.sceneId) : undefined;
  return `shot:${quickHash({
    v: STAGE_VERSION.shotGeneration,
    kind,
    modelId,
    shot: {
      id: shot.id,
      prompt: compileShotPrompt(doc, shot).hash,
      referenceAssetIds: shot.referenceAssetIds,
      seed: shot.seed,
      firstFrameAssetId: shot.firstFrameAssetId,
      lastFrameAssetId: shot.lastFrameAssetId,
      controlAssetId: shot.controlAssetId,
    },
    characters,
    scene,
  })}`;
}
