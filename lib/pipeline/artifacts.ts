import { lineSpeech, ttsKey, ttsRequestForLine, type TtsResult } from "../core/keys";
import { buildTimeline, type Artifacts } from "../core/timeline";
import { mediaUrl, type Aspect, type ProjectDoc } from "../core/types";
import { cacheMany } from "../server/cache";
import { get } from "../server/db";
import { effectiveLexicon } from "../server/lexicon";
import { appAsset, listTracks } from "../server/music";
import { voiceKeyOf } from "../core/keys";

/** 每句当前应使用的配音缓存键（朗读文本 + 音色） */
export function lineTtsKeys(doc: ProjectDoc, projectId: string) {
  const lex = effectiveLexicon(projectId);
  return doc.lines.map((l) => {
    const sp = lineSpeech(l, lex);
    const request = ttsRequestForLine(sp.spoken, l, doc.settings.voice.model);
    return { line: l, key: ttsKey(request.text, doc.settings.voice, request.textType), spoken: sp.spoken, ttsText: request.text, textType: request.textType, map: sp.map };
  });
}

/** 实测语速（字/分钟）；样本不足时返回 undefined */
export function measuredCpm(doc: ProjectDoc) {
  const r = get<{ chars: number; speech_ms: number; samples: number }>("SELECT * FROM voice_stats WHERE voice_key = ?", `${voiceKeyOf(doc.settings.voice)}@${doc.settings.voice.rate}`);
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
