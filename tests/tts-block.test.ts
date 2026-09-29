import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TtsResult } from "@/lib/core/keys";
import { emptyDoc, voiceSettingsSchema, type Job, type ProjectDoc } from "@/lib/core/types";
import type { StageContext } from "@/lib/pipeline/stage";
import type { SynthRequest, SynthResult, SynthWord } from "@/lib/providers/tts/types";
import { pcmToWav } from "@/lib/providers/tts/types";

// 假的配音服务商：按测试给定的方式返回合成音频
const synth = vi.fn<(req: SynthRequest) => SynthResult>();
vi.mock("@/lib/providers/tts/factory", async (orig) => ({
  ...(await orig<typeof import("@/lib/providers/tts/factory")>()),
  ttsProviderOf: () => ({ id: "dashscope", models: [], voices: () => [], synthesize: async (req: SynthRequest) => synth(req) }),
}));

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-tts-block-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => synth.mockReset());

const RATE = 24_000;
/** [时长ms, 是否发声] 拼成 WAV */
function wav(parts: [number, boolean][]) {
  const n = parts.reduce((s, [ms]) => s + (ms * RATE) / 1000, 0);
  const pcm = Buffer.alloc(n * 2);
  let i = 0;
  for (const [ms, voiced] of parts) for (let k = 0; k < (ms * RATE) / 1000; k++, i++) pcm.writeInt16LE(voiced ? Math.round(Math.sin((2 * Math.PI * 220 * i) / RATE) * 8000) : 0, i * 2);
  return pcmToWav(pcm, RATE);
}

function result(audio: Buffer, words: SynthWord[] = []): SynthResult {
  return { audio, mime: "audio/wav", sampleRate: RATE, channels: 1, durationMs: Math.round(((audio.length - 44) / 2 / RATE) * 1000), words, billedChars: 10 };
}

/** 逐字时间戳：texts[k] 在 [from, to) 内均匀分布 */
function words(texts: string[], spans: [number, number][]): SynthWord[] {
  return texts.flatMap((t, k) => {
    const chars = [...t].filter((c) => !/[，。]/.test(c));
    const [a, b] = spans[k];
    return chars.map((c, j) => ({ text: c, startMs: a + ((b - a) * j) / chars.length, endMs: a + ((b - a) * (j + 1)) / chars.length }));
  });
}

const ctx = (): StageContext => ({ job: { id: `job-${Math.random()}` } as Job, signal: new AbortController().signal, current: () => true, progress() {}, spend: () => 0, log() {} });
const texts = ["第一句话在这里。", "第二句话在这里。", "第三句话在这里。"];

async function paragraphProject(provider: "dashscope" | "google-gemini" = "dashscope", segmentText = texts.join("")) {
  const { createProject } = await import("@/lib/server/projects");
  const { syncLines } = await import("@/lib/core/sync");
  const doc: ProjectDoc = syncLines({ ...emptyDoc(), segments: [{ title: "测试", text: segmentText }] });
  doc.settings.voice = voiceSettingsSchema.parse(provider === "dashscope" ? { granularity: "paragraph" } : { provider, model: "gemini-3.8-flash-tts", voiceId: "Kore", granularity: "paragraph", google: {} });
  return createProject(doc);
}

describe("段落模式的配音键与任务", () => {
  it("同一自然段合成一块；块内句子共享任务，逐句键不变的模式不受影响", async () => {
    const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
    const { ttsSteps } = await import("@/lib/pipeline/tts-jobs");
    const p = await paragraphProject("dashscope", `${texts.join("")}\n单独一段的句子。`);
    const items = lineTtsKeys(p.doc, p.id);
    expect(items.map((i) => i.block?.index)).toEqual([0, 1, 2, undefined]);
    expect(new Set(items.slice(0, 3).map((i) => i.block!.key)).size).toBe(1);
    // 单句自然段按逐句键
    const line = lineTtsKeys({ ...p.doc, settings: { ...p.doc.settings, voice: { ...p.doc.settings.voice, granularity: "line" } } }, p.id);
    expect(items[3].key).toBe(line[3].key);
    expect(items[0].key).not.toBe(line[0].key);
    // 只重录其中一句，也整块提交
    const steps = ttsSteps(p.doc, p.id, [items[1]]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ stage: "tts-block", target: "第 1–3 句" });
    expect((steps[0].input as { lines: unknown[] }).lines).toHaveLength(3);
    expect(ttsSteps(p.doc, p.id, items).map((s) => s.stage)).toEqual(["tts-block", "tts"]);
  });

  it("单独录制的句子自成一块；Gemini 同样按段落分块", async () => {
    const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
    const p = await paragraphProject();
    const isolated = { ...p.doc, lines: p.doc.lines.map((l, k) => (k === 1 ? { ...l, ttsIsolated: true } : l)) };
    expect(lineTtsKeys(isolated, p.id).map((i) => i.block?.key ?? null)).toEqual([null, null, null]);
    const g = await paragraphProject("google-gemini");
    expect(lineTtsKeys(g.doc, g.id).map((i) => i.block?.index)).toEqual([0, 1, 2]);
    expect(lineTtsKeys(g.doc, g.id)[0].block!.joiner).toBe("");
  });
});

describe("段落配音步骤", () => {
  it("整段合成后按时间戳切成单句：各句独立音频、块内自然停顿、整段音频可回放", async () => {
    const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
    const { ttsSteps } = await import("@/lib/pipeline/tts-jobs");
    const { ttsBlockStage } = await import("@/lib/pipeline/stages/tts-block");
    const { cacheMany } = await import("@/lib/server/cache");
    const p = await paragraphProject();
    // 三句时长各不相同（素材按内容寻址，相同波形会合并）；句间停顿 600ms / 400ms
    synth.mockReturnValue(result(wav([[200, false], [1000, true], [600, false], [900, true], [400, false], [1100, true], [300, false]]), words(texts, [[200, 1200], [1800, 2700], [3100, 4200]])));
    const [step] = ttsSteps(p.doc, p.id, lineTtsKeys(p.doc, p.id));
    const out = await ttsBlockStage.run(step.input as never, ctx());
    expect(out).toMatchObject({ degraded: false, confidence: 1, lines: 3 });
    expect(synth).toHaveBeenCalledTimes(1);
    expect(synth.mock.calls[0][0].text).toBe(texts.join(""));

    const items = lineTtsKeys(p.doc, p.id);
    const hits = cacheMany<TtsResult>(items.map((i) => i.key));
    const r = items.map((i) => hits.get(i.key)!);
    expect(new Set(r.map((x) => x.assetId)).size).toBe(3);
    expect(r.map((x) => x.block!.index)).toEqual([0, 1, 2]);
    expect(Math.abs(r[0].block!.gapAfterMs - 600)).toBeLessThanOrEqual(20);
    expect(Math.abs(r[1].block!.gapAfterMs - 400)).toBeLessThanOrEqual(20);
    expect(r[2].block!.gapAfterMs).toBe(0);
    // 切片内的语音区间：第二句切片从 600ms 停顿的中点开始，语音约在 300ms 处开始、持续约 0.9s
    expect(Math.abs(r[1].speechStartMs - 300)).toBeLessThanOrEqual(20);
    expect(Math.abs(r[1].speechEndMs - r[1].speechStartMs - 900)).toBeLessThanOrEqual(20);
    expect(r[1].chars.every((c) => c.startMs >= r[1].speechStartMs && c.endMs <= r[1].speechEndMs)).toBe(true);
    expect(r.every((x) => x.block!.blockAssetId === r[0].block!.blockAssetId)).toBe(true);

    // 缓存齐了不再请求
    await ttsBlockStage.run(step.input as never, ctx());
    expect(synth).toHaveBeenCalledTimes(1);
  });

  it("整段切不准时对半拆开重录：两个子块各自沿用自然停顿，子块之间按普通停顿", async () => {
    const { lineTtsKeys, loadArtifacts } = await import("@/lib/pipeline/artifacts");
    const { ttsSteps } = await import("@/lib/pipeline/tts-jobs");
    const { ttsBlockStage } = await import("@/lib/pipeline/stages/tts-block");
    const { layoutLines, TIMING } = await import("@/lib/core/timeline");
    const four = ["甲组第一句话。", "甲组第二句话。", "乙组第一句话。", "乙组第二句话。"];
    const p = await paragraphProject("google-gemini", four.join(""));
    // 四句一起：没有停顿，切不开；两句一组：中间有 500ms 停顿（Gemini 没有时间戳，靠停顿切）
    synth.mockImplementation((req) => (req?.text.length ?? 0) > 20 ? result(wav([[100, false], [4000, true], [100, false]])) : result(wav([[150, false], [1000, true], [500, false], [1000, true], [150, false]])));
    const [step] = ttsSteps(p.doc, p.id, lineTtsKeys(p.doc, p.id));
    expect(step.stage).toBe("tts-block");
    const out = await ttsBlockStage.run(step.input as never, ctx());
    expect(synth).toHaveBeenCalledTimes(3);
    expect(synth.mock.calls.map(([req]) => req.text)).toEqual([four.join(""), four.slice(0, 2).join(""), four.slice(2).join("")]);
    expect(out).toMatchObject({ degraded: true, attempts: 3 });
    expect(out.reasons?.[0]).toContain("第 1–4 句");

    const art = loadArtifacts(p.doc, p.id);
    const r = p.doc.lines.map((l) => art.tts.get(l.id)!);
    expect(r.map((x) => [x.block?.index, x.block?.count, x.block?.splitSource])).toEqual([[0, 2, "vad"], [1, 2, "vad"], [0, 2, "vad"], [1, 2, "vad"]]);
    expect(r[0].block!.key).toBe(r[1].block!.key);
    expect(r[1].block!.key).not.toBe(r[2].block!.key);
    const { lines: laid } = layoutLines(p.doc.lines, art);
    expect(Math.abs(laid[1].startMs - laid[0].endMs - 500)).toBeLessThanOrEqual(20);
    expect(laid[2].startMs - laid[1].endMs).toBe(TIMING.pauseInSegmentMs);
  });

  it("拆到最小仍不可靠时逐句合成，写同样的键但不带块信息", async () => {
    const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
    const { ttsSteps } = await import("@/lib/pipeline/tts-jobs");
    const { ttsBlockStage } = await import("@/lib/pipeline/stages/tts-block");
    const { cacheMany } = await import("@/lib/server/cache");
    const p = await paragraphProject("dashscope", "另一段第一句。另一段第二句。另一段第三句。");
    // 多句请求都没有时间戳和停顿 → 切不开；单句请求正常
    synth.mockImplementation((req) => ((req?.text.length ?? 0) > 10 ? result(wav([[100, false], [3000, true], [100, false]])) : result(wav([[100, false], [800, true], [100, false]]))));
    const [step] = ttsSteps(p.doc, p.id, lineTtsKeys(p.doc, p.id));
    const out = await ttsBlockStage.run(step.input as never, ctx());
    // 整块 1 次 → 拆成 1 句 + 2 句：单句直接合成 1 次，两句块 1 次失败后逐句 2 次
    expect(synth).toHaveBeenCalledTimes(5);
    expect(out).toMatchObject({ degraded: true, attempts: 5 });
    const items = lineTtsKeys(p.doc, p.id);
    const hits = cacheMany<TtsResult>(items.map((i) => i.key));
    expect(hits.size).toBe(3);
    expect([...hits.values()].every((x) => !x.block)).toBe(true);
  });

  it("中途失败时一句都不写入，重试从头来", async () => {
    const { lineTtsKeys } = await import("@/lib/pipeline/artifacts");
    const { ttsSteps } = await import("@/lib/pipeline/tts-jobs");
    const { ttsBlockStage } = await import("@/lib/pipeline/stages/tts-block");
    const { cacheMany } = await import("@/lib/server/cache");
    const p = await paragraphProject("dashscope", "失败段第一句。失败段第二句。失败段第三句。");
    let n = 0;
    synth.mockImplementation((req) => {
      if (!req) return result(wav([[100, true]]));
      if (++n === 1) return result(wav([[100, false], [3000, true], [100, false]]));
      if (n === 2) return result(wav([[100, false], [800, true], [100, false]]));
      throw new Error("上游超时");
    });
    const [step] = ttsSteps(p.doc, p.id, lineTtsKeys(p.doc, p.id));
    await expect(ttsBlockStage.run(step.input as never, ctx())).rejects.toThrow("上游超时");
    expect(cacheMany(lineTtsKeys(p.doc, p.id).map((i) => i.key)).size).toBe(0);
  });
});

describe("切分校验与拆分", () => {
  const lines3 = [{ text: "第一句话在这里。" }, { text: "第二句话在这里。" }, { text: "第三句话在这里。" }];
  const split = (spans: [number, number][], confidence = 1) => ({ lines: spans.map(([startMs, endMs]) => ({ startMs, endMs, cutStartMs: 0, cutEndMs: 0 })), boundaries: [], confidence, source: "vad" as const });

  it("正常语速通过；整段太快判为漏读或截断，太慢判为重读", async () => {
    const { checkSplit } = await import("@/lib/pipeline/stages/tts-block");
    expect(checkSplit(lines3, split([[0, 1500], [2000, 3500], [4000, 5500]]), 4.5)).toEqual({ ok: true });
    expect(checkSplit(lines3, split([[0, 500], [600, 1100], [1200, 1700]]), 4.5)).toMatchObject({ ok: false, reason: expect.stringContaining("漏读") });
    expect(checkSplit(lines3, split([[0, 5000], [5500, 10500], [11000, 16000]]), 4.5)).toMatchObject({ ok: false, reason: expect.stringContaining("重读") });
  });

  it("某句语速与整段差太多判为句界切错；置信度过低直接不通过", async () => {
    const { checkSplit } = await import("@/lib/pipeline/stages/tts-block");
    expect(checkSplit(lines3, split([[0, 400], [500, 2900], [3000, 5000]]), 4.5)).toMatchObject({ ok: false, reason: expect.stringContaining("第 1 句") });
    expect(checkSplit(lines3, split([[0, 1500], [2000, 3500], [4000, 5500]], 0.3), 4.5)).toMatchObject({ ok: false, reason: expect.stringContaining("置信度") });
  });

  it("对半拆：字数接近，优先在句号处", async () => {
    const { halve } = await import("@/lib/pipeline/stages/tts-block");
    const t = (text: string) => ({ text });
    expect(halve([t("一二三四。"), t("五六七八。"), t("九十一二。"), t("三四五六。")]).map((h) => h.length)).toEqual([2, 2]);
    // 字数最均衡的位置在逗号后，但句号处只差一点，优先句号
    expect(halve([t("一二三四五六，"), t("七八九十。"), t("一二三四五六七八九十。")]).map((h) => h.length)).toEqual([2, 1]);
  });
});
