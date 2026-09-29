import { describe, expect, it } from "vitest";
import { characterCardSchema, emptyDoc, voiceSettingsSchema, type Shot } from "./types";
import { shotGenerationKey, ttsBlockKey, ttsBlockLineKey, ttsKey, ttsRequestForLine, ttsTextForLine } from "./keys";
import { quickHash } from "./hash";
import { builtinVisualStyles } from "../visual-styles/builtin";

const shot = (patch: Partial<Shot> = {}): Shot => ({
  id: "shot-1",
  at: { lineId: "line-1", char: 0 },
  kind: "image",
  description: "一座雨中的城市",
  motion: "none",
  importance: 2,
  referenceAssetIds: ["a"],
  characterIds: [],
  candidates: [],
  sourceHash: "source",
  locked: false,
  ...patch,
});

describe("镜头生成缓存键", () => {
  it("会随 seed、参考素材和模型变化", () => {
    const doc = emptyDoc();
    const base = shotGenerationKey(doc, shot({ seed: 1 }), "image", "image-generation");
    expect(shotGenerationKey(doc, shot({ seed: 2 }), "image", "image-generation")).not.toBe(base);
    expect(shotGenerationKey(doc, shot({ referenceAssetIds: ["b"] }), "image", "image-generation")).not.toBe(base);
    expect(shotGenerationKey(doc, shot({ seed: 1 }), "video", "video-generation")).not.toBe(base);
  });

  it("包含角色卡和场景卡的内容", () => {
    const doc = { ...emptyDoc(), characters: [characterCardSchema.parse({ id: "c", name: "主角", appearance: "黑发", wardrobe: "风衣", referenceAssetIds: [], locked: true })], scenes: [{ id: "s", name: "街道", description: "雨夜", style: "写实", referenceAssetIds: [], locked: true }] };
    const base = shotGenerationKey(doc, shot({ characterIds: ["c"], sceneId: "s" }), "image", "image-generation");
    const changed = { ...doc, scenes: [{ ...doc.scenes[0], description: "晴天" }] };
    expect(shotGenerationKey(changed, shot({ characterIds: ["c"], sceneId: "s" }), "image", "image-generation")).not.toBe(base);
  });

  it("随风格和画面描述变化，不随运镜变化", () => {
    const doc = { ...emptyDoc(), visualStyle: builtinVisualStyles[0] };
    const base = shotGenerationKey(doc, shot(), "image", "image-generation");
    expect(shotGenerationKey({ ...doc, visualStyle: builtinVisualStyles[1] }, shot(), "image", "image-generation")).not.toBe(base);
    expect(shotGenerationKey(doc, shot({ description: "一座晴天的城市" }), "image", "image-generation")).not.toBe(base);
    expect(shotGenerationKey(doc, shot({ shotSize: "close" }), "image", "image-generation")).not.toBe(base);
    expect(shotGenerationKey(doc, shot({ motion: "zoom-in" }), "image", "image-generation")).toBe(base);
  });
});

describe("Qwen-Audio 逐句表达标签", () => {
  it("自动跟随已标注情绪，手动标签可覆盖或关闭", () => {
    const line = { mood: "忧伤" as const, voiceTag: "auto" as const };
    expect(ttsTextForLine("这段旁白。", line, "qwen-audio-3.0-tts-plus")).toBe("[sad]这段旁白。");
    expect(ttsTextForLine("这段旁白。", { ...line, voiceTag: "excited" }, "qwen-audio-3.0-tts-plus")).toBe("[excited]这段旁白。");
    expect(ttsTextForLine("这段旁白。", { ...line, voiceTag: "none" }, "qwen-audio-3.0-tts-plus")).toBe("这段旁白。");
  });

  it("不向 CosyVoice 注入标签，且标签会改变 TTS 缓存键", () => {
    const line = { mood: "激昂" as const, voiceTag: "auto" as const };
    const plain = ttsTextForLine("开始吧。", line, "cosyvoice-v3-flash");
    const tagged = ttsTextForLine("开始吧。", line, "qwen-audio-3.0-tts-flash");
    const voice = emptyDoc().settings.voice;
    expect(plain).toBe("开始吧。");
    expect(tagged).toBe("[excited]开始吧。");
    expect(ttsKey(plain, voice)).not.toBe(ttsKey(tagged, voice));
  });

  it("SSML 停顿模式会转义文本、保留纯文本对齐内容，并使用独立缓存键", () => {
    const line = { mood: "激昂" as const, voiceTag: "ssml:measured" as const };
    const request = ttsRequestForLine("第一句，<重点>结束。", line, "qwen-audio-3.0-tts-plus");
    expect(request).toEqual({ text: "<speak>第一句，<break time=\"280ms\"/>&lt;重点&gt;结束。</speak>", textType: "SSML" });
    expect(ttsRequestForLine("甲，乙；丙", { ...line, voiceTag: "ssml:compact" }, "qwen-audio-3.0-tts-plus").text).toBe("<speak>甲，<break time=\"100ms\"/>乙；<break time=\"160ms\"/>丙</speak>");
    expect(ttsRequestForLine("句尾，", line, "qwen-audio-3.0-tts-plus").text).toBe("<speak>句尾，</speak>");
    expect(ttsTextForLine("第一句，<重点>结束。", line, "cosyvoice-v3-flash")).toBe("第一句，<重点>结束。");

    const voice = emptyDoc().settings.voice;
    expect(ttsKey("同一句", voice, "SSML")).not.toBe(ttsKey("同一句", voice));
    expect(ttsKey("<speak>SSML</speak>", voice, "SSML")).toBe(ttsKey("<speak>SSML</speak>", { ...voice, instruction: "另一种全局指令" }, "SSML"));
    expect(ttsKey("历史纯文本", voice)).toBe(ttsKey("历史纯文本", voice, "PlainText"));
  });
});

describe("Gemini TTS 缓存指纹", () => {
  it("忽略已停用的 style，仍区分输出编码、采样率和对齐策略", () => {
    const voice = { ...emptyDoc().settings.voice, provider: "google-gemini" as const, model: "gemini-3.8-flash-tts", voiceId: "Kore", google: { stylePrompt: "沉稳", outputEncoding: "LINEAR16" as const, sampleRateHertz: 24000, alignment: "estimated" as const } };
    const base = ttsKey("同一句", voice);
    const oldKey = `tts:${quickHash({ v: 3, s: "同一句", p: voice.provider, m: voice.model, id: voice.voiceId, r: voice.rate, pi: voice.pitch, vo: voice.volume, instruction: voice.instruction, google: voice.google })}`;
    expect(base).not.toBe(oldKey);
    expect(ttsKey("同一句", { ...voice, google: { ...voice.google, stylePrompt: "明快" } })).toBe(base);
    expect(ttsKey("同一句", { ...voice, google: { ...voice.google, outputEncoding: "WAV" } })).not.toBe(base);
    expect(ttsKey("同一句", { ...voice, google: { ...voice.google, sampleRateHertz: 48000 } })).not.toBe(base);
    expect(ttsKey("同一句", { ...voice, google: { ...voice.google, alignment: "provider" } })).not.toBe(base);
  });
});

describe("段落配音缓存键", () => {
  it("逐句键与引入段落模式之前逐字一致（旧缓存不失效），合成粒度不影响逐句键", () => {
    const d = voiceSettingsSchema.parse({});
    expect(ttsKey("第一句。", d)).toBe("tts:ff9e19094e07b53e8f70a72fd027d332");
    expect(ttsKey("<speak>a</speak>", { ...d, instruction: "稳" }, "SSML")).toBe("tts:c0a564812151a7172abb0908df496a41");
    expect(ttsKey("第一句。", { ...d, instruction: "稳" })).toBe("tts:45c035d0e4c9dd116fa9b5ec1c8d52b5");
    expect(ttsKey("第一句。", { ...d, granularity: "paragraph" })).toBe(ttsKey("第一句。", d));
  });

  it("块键随块内任一句、连接方式和音色变化；块内各句的键互不相同", () => {
    const d = voiceSettingsSchema.parse({});
    const base = ttsBlockKey(["甲。", "乙。"], "", d);
    expect(ttsBlockKey(["甲。", "丙。"], "", d)).not.toBe(base);
    expect(ttsBlockKey(["甲。", "乙。"], "\n", d)).not.toBe(base);
    expect(ttsBlockKey(["甲。", "乙。"], "", { ...d, voiceId: "other" })).not.toBe(base);
    expect(ttsBlockLineKey(base, 0)).not.toBe(ttsBlockLineKey(base, 1));
    expect(ttsBlockLineKey(base, 0)).not.toBe(ttsKey("甲。", d));
  });
});
