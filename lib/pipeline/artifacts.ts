import { PARAGRAPH_JOINERS, blockLimitsFor, planBlocks } from "../core/blocks";
import { lineSpeech, ttsBlockKey, ttsBlockLineKey, ttsKey, ttsRequestForLine, type TtsResult } from "../core/keys";
import { buildTimeline, type Artifacts } from "../core/timeline";
import { mediaUrl, type Aspect, type Line, type ProjectDoc, type VoiceSettings } from "../core/types";
import { cacheMany } from "../server/cache";
import { get } from "../server/db";
import { effectiveLexicon } from "../server/lexicon";
import { appAsset, listTracks } from "../server/music";
import { voiceKeyOf } from "../core/keys";

/** 块内一句的合成材料 */
export type BlockMember = { lineId: string; key: string; text: string; spoken: string; map: number[] };
export type BlockRef = { key: string; index: number; joiner: string; members: BlockMember[] };

/**
 * 每句当前应使用的配音缓存键（朗读文本 + 音色）。
 * 段落模式下同一块的句子共享 block（members 是整块，重录其中一句时整块一起提交）。
 */
export function lineTtsKeys(doc: ProjectDoc, projectId: string) {
  const lex = effectiveLexicon(projectId);
  const voice = doc.settings.voice;
  const items = doc.lines.map((l) => {
    const sp = lineSpeech(l, lex);
    const request = ttsRequestForLine(sp.spoken, l, voice.model);
    return { line: l, key: ttsKey(request.text, voice, request.textType), spoken: sp.spoken, ttsText: request.text, textType: request.textType, map: sp.map, block: undefined as BlockRef | undefined };
  });
  const joiner = PARAGRAPH_JOINERS[voice.provider];
  if (voice.granularity !== "paragraph" || joiner === undefined) return items;

  const byId = new Map(items.map((item) => [item.line.id, item]));
  // 带情绪标签或 SSML 的句子单独录：标签能否在段中生效还没验证
  const alone = (l: Line) => !!l.ttsIsolated || byId.get(l.id)!.ttsText !== byId.get(l.id)!.spoken || !!byId.get(l.id)!.textType;
  for (const group of planBlocks(doc.lines, doc.segments, { ...blockLimitsFor(voice.provider), alone })) {
    if (group.length < 2) continue; // 单句块就是逐句合成，沿用逐句键和缓存
    const members = group.map((l) => byId.get(l.id)!);
    const key = ttsBlockKey(members.map((m) => m.spoken), joiner, voice);
    const ref: Omit<BlockRef, "index"> = { key, joiner, members: members.map((m, i) => ({ lineId: m.line.id, key: ttsBlockLineKey(key, i), text: m.line.text, spoken: m.spoken, map: m.map })) };
    members.forEach((m, i) => {
      m.key = ref.members[i].key;
      m.block = { ...ref, index: i };
    });
  }
  return items;
}

/** 实测语速（字/分钟）；样本不足时返回 undefined */
export function measuredCpm(doc: ProjectDoc) {
  return measuredCpmOf(doc.settings.voice);
}

export function measuredCpmOf(voice: VoiceSettings) {
  const r = get<{ chars: number; speech_ms: number; samples: number }>("SELECT * FROM voice_stats WHERE voice_key = ?", voiceKeyOf(voice));
  return r && r.samples >= 5 && r.speech_ms > 0 ? (r.chars / r.speech_ms) * 60_000 : undefined;
}

/** 组装时间轴所需的机器产物；media 决定素材地址（网页用 /api/media，渲染用本地静态服务） */
export function loadArtifacts(doc: ProjectDoc, projectId: string, media: (hash: string) => string = mediaUrl): Artifacts {
  const keys = lineTtsKeys(doc, projectId);
  const hits = cacheMany<TtsResult>(keys.map((k) => k.key));
  const tracks = listTracks();
  const whoosh = appAsset("sfx.whoosh.v1");
  return {
    tts: new Map(keys.map((k) => [k.line.id, hits.get(k.key)])),
    tracks: new Map(tracks.map((t) => [t.id, t])),
    sfx: { whoosh: whoosh ? media(whoosh) : undefined },
    charsPerMinute: measuredCpm(doc),
    media,
  };
}

export function timelineFor(doc: ProjectDoc, projectId: string, aspect: Aspect, media?: (hash: string) => string) {
  return buildTimeline(doc, loadArtifacts(doc, projectId, media), aspect);
}
