import { alignWords, contentCount, evenChars, toOriginal, type CharTime } from "../../core/align";
import { strongEnd } from "../../core/blocks";
import type { TtsResult } from "../../core/keys";
import type { VoiceSettings } from "../../core/types";
import type { SynthWord } from "../../providers/tts/types";
import { cacheMany } from "../../server/cache";
import { putBuffer } from "../../server/media";
import { measuredCpmOf, type BlockMember } from "../artifacts";
import { defineStage, type StageContext } from "../stage";
import { assertCurrent, commitCache, lineResult, recordVoiceStats, trackedSynthesis } from "../tts-common";
import { decodeWav, durationMsOf, encodeWav, frameDb, silenceLine, sliceWav, splitBySilence, splitByTimestamps, type SplitResult, type Wav } from "../tts-split";

/**
 * 段落配音：一块（同一自然段的几句）一次合成，再切成单句写入各句的缓存键。
 * 降级链：整块 → 切分或语速校验不过 → 对半拆开各自重合成（最多两层）→ 仍不过就逐句合成。
 * 所有结果最后一次性写入缓存，不留半截；字幕和镜头锚点不会因为切错而错位。
 */

export type TtsBlockInput = {
  projectId: string;
  blockKey: string;
  joiner: string;
  lines: BlockMember[];
  voice: VoiceSettings;
  force?: boolean;
};

/** 低于这个切分置信度就不采用（静音切分在探针里多为 0.64–0.95，时间戳切分为 0.6 或 1） */
export const MIN_SPLIT_CONFIDENCE = 0.5;
/** 对半拆开的最大层数：8 句的块最多拆到 2 句一组 */
export const MAX_HALVING = 2;
/**
 * 语速校验（探针 20 段实测：切对时单句语速为整段的 0.59–1.57 倍，整段 3.9–5.2 字/秒）。
 * 整段偏离音色实测语速太多 → 漏读、重读或截断；某句偏离整段太多 → 句界切错。
 */
export const RATE_BOUNDS = { block: [0.55, 1.8], line: [0.45, 2.0] } as const;
/** 没有实测语速时的参考值（字/秒） */
const DEFAULT_CPS = 4.5;

type Output = { blockKey: string; lines: number; degraded: boolean; attempts: number; confidence?: number; reasons?: string[] };
type Member = BlockMember & { index: number };
type Group = { entries: [string, TtsResult][]; outputs: string[] };

export const ttsBlockStage = defineStage<TtsBlockInput, Output>({
  name: "tts-block",
  concurrency: 2,
  async run(input, ctx) {
    const keys = input.lines.map((l) => l.key);
    if (!input.force && cacheMany(keys).size === keys.length) return { blockKey: input.blockKey, lines: keys.length, degraded: false, attempts: 0 };

    const measured = measuredCpmOf(input.voice);
    const state = { attempts: 0, done: 0, total: input.lines.length, reasons: [] as string[], refCps: measured ? measured / 60 : DEFAULT_CPS * (input.voice.provider === "dashscope" ? input.voice.rate : 1) };
    ctx.progress(0.05, "整段合成中");
    const entries = await synthGroup(ctx, input, input.lines.map((l, index) => ({ ...l, index })), 0, state);
    commitCache(ctx, entries);

    const blocked = entries.filter(([, r]) => r.block);
    recordVoiceStats(input.voice, blocked.reduce((s, [, r]) => s + r.spokenChars, 0), blocked.reduce((s, [, r]) => s + r.speechEndMs - r.speechStartMs, 0));
    const confidences = blocked.map(([, r]) => r.block!.confidence);
    ctx.progress(1);
    return { blockKey: input.blockKey, lines: keys.length, degraded: state.reasons.length > 0, attempts: state.attempts, confidence: confidences.length ? Math.min(...confidences) : undefined, ...(state.reasons.length ? { reasons: state.reasons } : {}) };
  },
});

type State = { attempts: number; done: number; total: number; reasons: string[]; refCps: number };

async function synthGroup(ctx: StageContext, input: TtsBlockInput, members: Member[], depth: number, state: State): Promise<[string, TtsResult][]> {
  if (members.length === 1) return [await synthLine(ctx, input, members[0], state)];
  // 子块用自己的键：时间轴只在同一子块内沿用自然停顿，子块之间按普通停顿
  const key = depth === 0 ? input.blockKey : `${input.blockKey}#${members[0].index}-${members[members.length - 1].index}`;
  const text = members.map((m) => m.spoken).join(input.joiner);
  state.attempts++;
  const params = { stage: "tts-block", depth, lineCount: members.length, textLength: text.length };
  const group = await trackedSynthesis(ctx, { projectId: input.projectId, voice: input.voice, text, billText: text, inputHash: key, params }, async (res) => {
    const alignmentSource = res.words.length ? "provider" : "estimated";
    const split = splitBlock({ lines: members, joiner: input.joiner }, text, res.words, decodeWav(res.audio));
    const check = checkSplit(members, split.result, state.refCps);
    if (!check.ok) {
      // 费用已经发生，生成记录照常记为成功；这段音频不入库
      state.reasons.push(`第 ${members[0].index + 1}–${members[members.length - 1].index + 1} 句：${check.reason}`);
      return { value: null, outputAssets: [], alignmentSource };
    }
    assertCurrent(ctx);
    const out = await storeGroup(input, members, key, split, res.words.length > 0, alignmentSource, res.usage);
    return { value: out, outputAssets: out.outputs, alignmentSource };
  });
  if (group) {
    state.done += members.length;
    ctx.progress(0.1 + (0.9 * state.done) / state.total, "切分完成");
    return group.entries;
  }
  ctx.log(state.reasons[state.reasons.length - 1]);
  if (depth >= MAX_HALVING) {
    const out: [string, TtsResult][] = [];
    for (const m of members) out.push(await synthLine(ctx, input, m, state));
    return out;
  }
  const [left, right] = halve(members);
  ctx.progress(0.1 + (0.9 * state.done) / state.total, "切分不可靠，拆小重录");
  return [...(await synthGroup(ctx, input, left, depth + 1, state)), ...(await synthGroup(ctx, input, right, depth + 1, state))];
}

/** 逐句兜底：写同样的键，不带块信息（时间轴按逐句规则排） */
async function synthLine(ctx: StageContext, input: TtsBlockInput, m: Member, state: State): Promise<[string, TtsResult]> {
  state.attempts++;
  ctx.progress(0.1 + (0.9 * state.done) / state.total, `逐句补录第 ${m.index + 1} 句`);
  const entry = await trackedSynthesis(ctx, { projectId: input.projectId, voice: input.voice, text: m.spoken, billText: m.spoken, inputHash: m.key, params: { stage: "tts-block", fallback: "line", textLength: m.text.length } }, async (res) => {
    const timing = lineResult(m, res.words, res.durationMs, res.alignmentSource);
    assertCurrent(ctx);
    const asset = await putBuffer(res.audio, { ext: "wav", mime: "audio/wav", meta: { kind: "tts-block-fallback", provider: input.voice.provider, model: input.voice.model, voice: input.voice.voiceId, durationMs: res.durationMs, alignmentSource: timing.alignmentSource, text: m.text, spoken: m.spoken } });
    return { value: [m.key, { assetId: asset.hash, ...timing }] as [string, TtsResult], outputAssets: [asset.hash], alignmentSource: timing.alignmentSource! };
  });
  state.done++;
  return entry;
}

/** 整段音频和各句切片入库，生成各句的配音结果（尚未写缓存） */
async function storeGroup(input: TtsBlockInput, members: Member[], key: string, split: ReturnType<typeof splitBlock>, aligned: boolean, alignmentSource: "provider" | "estimated", usage: unknown): Promise<Group> {
  const meta = { provider: input.voice.provider, model: input.voice.model, voice: input.voice.voiceId, alignmentSource };
  const r = split.result;
  const block = await putBuffer(encodeWav(split.wav), { ext: "wav", mime: "audio/wav", meta: { ...meta, kind: "tts-block", durationMs: Math.round(durationMsOf(split.wav)), usage, text: members.map((m) => m.text).join(""), split: { source: r.source, confidence: r.confidence, cutsMs: r.boundaries.map((b) => Math.round(b.cutMs)) } } });
  const entries: [string, TtsResult][] = [];
  for (const [k, m] of members.entries()) {
    const piece = r.lines[k];
    const slice = sliceWav(split.wav, piece.cutStartMs, piece.cutEndMs);
    const durationMs = Math.round(durationMsOf(slice));
    const asset = await putBuffer(encodeWav(slice), { ext: "wav", mime: "audio/wav", meta: { ...meta, kind: "tts-block-line", blockAssetId: block.hash, index: k, durationMs, text: m.text, spoken: m.spoken } });
    const speechStartMs = piece.startMs - piece.cutStartMs;
    const speechEndMs = Math.max(speechStartMs + 1, piece.endMs - piece.cutStartMs);
    entries.push([m.key, {
      assetId: asset.hash,
      durationMs,
      speechStartMs,
      speechEndMs,
      chars: clampChars(split.chars[k] ?? [], m.text, speechStartMs, speechEndMs, piece.cutStartMs),
      aligned,
      alignmentSource,
      spokenChars: contentCount(m.text),
      block: {
        key,
        index: k,
        count: members.length,
        gapAfterMs: k + 1 < members.length ? Math.max(0, Math.round(r.lines[k + 1].startMs - piece.endMs)) : 0,
        confidence: Math.min(r.boundaries[k]?.confidence ?? 1, r.boundaries[k - 1]?.confidence ?? 1),
        splitSource: r.source,
        blockAssetId: block.hash,
      },
    }]);
  }
  return { entries, outputs: [block.hash, ...entries.map(([, e]) => e.assetId)] };
}

/**
 * 校验切分结果。只看语速，不依赖服务商时间戳，Gemini（无时间戳）同样适用：
 * 整段语速与音色实测语速相比过快 / 过慢 → 漏读、重读或被截断；某句与整段相比过快 / 过慢 → 句界切错。
 */
export function checkSplit(lines: { text: string }[], split: SplitResult, refCps: number): { ok: true } | { ok: false; reason: string } {
  if (split.confidence < MIN_SPLIT_CONFIDENCE) return { ok: false, reason: `切分置信度 ${split.confidence} 过低` };
  const chars = lines.map((l) => contentCount(l.text));
  const speech = split.lines.map((l) => Math.max(1, l.endMs - l.startMs) / 1000);
  const blockCps = chars.reduce((s, c) => s + c, 0) / speech.reduce((s, x) => s + x, 0);
  const ratio = blockCps / refCps;
  if (ratio < RATE_BOUNDS.block[0] || ratio > RATE_BOUNDS.block[1]) return { ok: false, reason: `整段语速 ${blockCps.toFixed(1)} 字/秒（参考 ${refCps.toFixed(1)}），疑似${ratio > 1 ? "漏读或被截断" : "重读或拖沓"}` };
  for (const [k, c] of chars.entries()) {
    if (c < 4) continue; // 两三个字的短句语速波动大，不参与判断
    const r = c / speech[k] / blockCps;
    if (r < RATE_BOUNDS.line[0] || r > RATE_BOUNDS.line[1]) return { ok: false, reason: `第 ${k + 1} 句语速是整段的 ${r.toFixed(2)} 倍，疑似句界切错` };
  }
  return { ok: true };
}

/** 对半拆：两边字数尽量接近，优先在句末强停顿处拆 */
export function halve<T extends { text: string }>(members: T[]): [T[], T[]] {
  const size = members.map((m) => Math.max(1, contentCount(m.text)));
  const total = size.reduce((s, x) => s + x, 0);
  let best = 1;
  let bestCost = Infinity;
  let left = 0;
  for (let k = 1; k < members.length; k++) {
    left += size[k - 1];
    const cost = Math.abs(total - 2 * left) / total + (strongEnd(members[k - 1].text) ? 0 : 0.2);
    if (cost < bestCost) {
      bestCost = cost;
      best = k;
    }
  }
  return [members.slice(0, best), members.slice(best)];
}

/** 找句界；有时间戳时同时得到每句原文字符的时间（段落音频内毫秒） */
export function splitBlock(input: { lines: Pick<BlockMember, "text" | "spoken" | "map">[]; joiner: string }, text: string, words: SynthWord[], wav: Wav): { wav: Wav; result: SplitResult; chars: CharTime[][] } {
  const db = frameDb(wav);
  const durationMs = durationMsOf(wav);
  if (!words.length) return { wav, result: splitBySilence(db, input.lines.map((l) => silenceLine(l.text)), durationMs), chars: [] };
  const times = alignWords(text, words);
  let offset = 0;
  const chars: CharTime[][] = [];
  const lineTimes = input.lines.map((line) => {
    const own = times.slice(offset, offset + line.spoken.length);
    offset += line.spoken.length + input.joiner.length;
    chars.push(toOriginal(line.text, own, line.map));
    const timed = own.filter((t) => t !== null);
    return timed.length ? { startMs: timed[0].startMs, endMs: timed[timed.length - 1].endMs } : { startMs: 0, endMs: 0 };
  });
  return { wav, result: splitByTimestamps(db, lineTimes, durationMs), chars };
}

/** 字时间换算到切片内并夹进有效语音区间；没有时间戳时按字数均分 */
function clampChars(chars: CharTime[], text: string, startMs: number, endMs: number, offsetMs: number): CharTime[] {
  if (!chars.length) return evenChars(text, startMs, endMs);
  const clamp = (ms: number) => Math.round(Math.min(endMs, Math.max(startMs, ms - offsetMs)));
  return chars.map((c) => ({ i: c.i, startMs: clamp(c.startMs), endMs: clamp(c.endMs) }));
}
