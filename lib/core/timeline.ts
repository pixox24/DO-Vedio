import { evenChars, contentCount } from "./align";
import { fallbackCard, sanitizeCard } from "./cards";
import { themeOf, type VideoTheme } from "./theme";
import { quickHash } from "./hash";
import type { TtsResult } from "./keys";
import { dbToGain, duckEnvelope, type Envelope } from "./mix";
import { anchorMs, sortShots, type LineTime } from "./shots";
import { cuesForLine, type Cue } from "./subtitles";
import { aspectSize, shotKindLabels, type Aspect, type Card, type Line, type ProjectDoc, type ShotKind, type ShotMode, type Motion } from "./types";

/**
 * 时间轴 —— 纯函数。输入 = 项目文档 + 机器产物（配音缓存、曲库），输出 = Remotion 的 inputProps。
 * 预览播放器、最终渲染、SRT 导出都读它，所见即所得。
 */

export const FPS = 30;
export const TIMING = { leadInMs: 500, tailMs: 1500, pauseInSegmentMs: 250, pauseBetweenSegmentsMs: 700 };

export type MusicTrack = { id: string; title: string; assetId: string; durationMs: number; moods: string[]; loopable: boolean; gainDb?: number };

export type TimelineVoice = { lineId: string; src: string; startMs: number; durationMs: number; trimStartMs: number };
export type TimelineShot = {
  shotId: string;
  kind: ShotKind;
  startMs: number;
  endMs: number;
  motion: Motion;
  description: string;
  onScreenText?: string;
  imageSrc?: string;
  /** AI 视频镜头的本地媒体地址；与图片地址分开，避免视频回退成占位卡。 */
  videoSrc?: string;
  focus?: { x: number; y: number };
  /** 章节标题卡：章节序号和标题 */
  chapter?: { index: number; title: string };
  /** 覆盖的句子原文（占位卡片显示用） */
  caption: string;
  keywords: string[];
  seed: number;
  mode?: ShotMode;
  /** 信息卡：大模型给的数据优先，没有时按旁白保守兜底（见 lib/core/cards.ts） */
  card: Card;
};


export type TimelineMusic = { trackId: string; src: string; startMs: number; endMs: number; offsetMs: number; durationMs: number; loop: boolean; fadeInMs: number; fadeOutMs: number; envelope: Envelope; baseGain: number };
export type TimelineSfx = { src: string; atMs: number; gain: number };

export type Timeline = {
  fps: number;
  width: number;
  height: number;
  aspect: Aspect;
  durationMs: number;
  durationInFrames: number;
  title: string;
  /** Remotion 画面主题，由视觉风格卡派生 */
  theme: VideoTheme;
  voice: TimelineVoice[];
  lines: { id: string; startMs: number; endMs: number; estimated: boolean; segmentIndex: number }[];
  shots: TimelineShot[];
  cues: Cue[];
  music: TimelineMusic[];
  sfx: TimelineSfx[];
  subtitle: { enabled: boolean; highlight: boolean };
  aiLabel: { enabled: boolean; position: "top-left" | "top-right" };
  issues: { level: "info" | "warn"; message: string; lineId?: string }[];
};

export type Artifacts = {
  /** lineId → 配音结果 */
  tts: Map<string, TtsResult | undefined>;
  tracks: Map<string, MusicTrack>;
  sfx?: { whoosh?: string };
  /** 实测语速（字/分钟）；没有时用 250 */
  charsPerMinute?: number;
  media: (hash: string) => string;
};

/** 句子时间：有配音用真实时长，没有就按语速估算 */
export function layoutLines(lines: Line[], art: Pick<Artifacts, "tts" | "charsPerMinute">) {
  const cpm = art.charsPerMinute ?? 250;
  let t = TIMING.leadInMs;
  const out: (LineTime & { estimated: boolean; tts?: TtsResult; segmentIndex: number })[] = [];
  lines.forEach((l, k) => {
    const tts = art.tts.get(l.id);
    let chars: LineTime["chars"];
    let dur: number;
    if (tts) {
      dur = tts.speechEndMs - tts.speechStartMs;
      chars = tts.chars.map((c) => ({ i: c.i, startMs: t + c.startMs - tts.speechStartMs, endMs: t + c.endMs - tts.speechStartMs }));
    } else {
      dur = Math.max(600, (contentCount(l.text) / cpm) * 60_000);
      chars = evenChars(l.text, t, t + dur);
    }
    out.push({ id: l.id, startMs: t, endMs: t + dur, chars, estimated: !tts, tts, segmentIndex: l.segmentIndex });
    const next = lines[k + 1];
    // 段落配音的块内：用原音频里的自然停顿；块尾才看标注停顿 / 默认停顿
    const pause = next && sameBlock(tts, art.tts.get(next.id)) ? tts!.block!.gapAfterMs : (l.pauseAfterMs ?? (next && next.segmentIndex !== l.segmentIndex ? TIMING.pauseBetweenSegmentsMs : TIMING.pauseInSegmentMs));
    t += dur + pause;
  });
  return { lines: out, endMs: t };
}

/** 两句是否是同一段落块里前后相邻的两句（中间的停顿和换气来自原音频） */
export function sameBlock(a: TtsResult | undefined, b: TtsResult | undefined) {
  return !!a?.block && !!b?.block && a.block.key === b.block.key && b.block.index === a.block.index + 1;
}

export function buildTimeline(doc: ProjectDoc, art: Artifacts, aspect: Aspect): Timeline {
  const { width, height } = aspectSize[aspect];
  const issues: Timeline["issues"] = [];
  const { lines: laid, endMs } = layoutLines(doc.lines, art);
  const durationMs = Math.max(1000, Math.round(endMs + TIMING.tailMs - (doc.lines.length ? (doc.lines.at(-1)!.pauseAfterMs ?? TIMING.pauseInSegmentMs) : 0)));
  const times = new Map(laid.map((l) => [l.id, l as LineTime]));
  const lineById = new Map(doc.lines.map((l) => [l.id, l]));

  const missing = laid.filter((l) => l.estimated).length;
  if (missing) issues.push({ level: "warn", message: `${missing} 句还没有配音，按估算时长显示为静音` });

  // 配音
  // 块内相邻两句的切片首尾相接：前一句播到切点（保留尾音），后一句从切点开始（保留换气）
  const voice: TimelineVoice[] = laid.flatMap((l, k) => {
    const tts = l.tts;
    if (!tts) return [];
    const lead = sameBlock(laid[k - 1]?.tts, tts) ? tts.speechStartMs : 0;
    const tail = sameBlock(tts, laid[k + 1]?.tts) ? tts.durationMs - tts.speechEndMs : 0;
    return [{ lineId: l.id, src: art.media(tts.assetId), startMs: l.startMs - lead, durationMs: l.endMs - l.startMs + lead + tail, trimStartMs: tts.speechStartMs - lead }];
  });

  // 镜头
  const sorted = sortShots(doc.shots, doc.lines);
  const shots: TimelineShot[] = sorted.map((s, k) => {
    const startMs = k === 0 ? 0 : (anchorMs(s.at, times) ?? 0);
    const endMs = k + 1 < sorted.length ? (anchorMs(sorted[k + 1].at, times) ?? durationMs) : durationMs;
    const coveredLaid = laid.filter((l) => l.endMs > startMs && l.startMs < endMs);
    const covered = coveredLaid.map((l) => lineById.get(l.id)!);
    // 只取在本镜头时间范围内说出的关键词（镜头可能从句中开始）
    const keywords = coveredLaid.flatMap((l) => {
      const line = lineById.get(l.id)!;
      return line.keywords.filter((k) => {
        const i = line.text.indexOf(k);
        const c = l.chars.find((x) => x.i >= i);
        const at = c ? c.startMs : l.startMs;
        return at >= startMs - 50 && at < endMs;
      });
    });
    const seg = lineById.get(s.at.lineId)?.segmentIndex ?? 0;
    const caption = covered.map((l) => l.text).join("");
    const seed = s.seed ?? parseInt(quickHash(s.id).slice(0, 6), 16);
    return {
      shotId: s.id,
      kind: s.kind,
      startMs,
      endMs,
      motion: s.motion,
      description: s.description,
      onScreenText: s.onScreenText,
      imageSrc: s.assetId && s.kind !== "video" ? art.media(s.assetId) : undefined,
      videoSrc: s.assetId && s.kind === "video" ? art.media(s.assetId) : undefined,
      focus: s.focus,
      chapter: s.kind === "title" ? { index: seg + 1, title: s.onScreenText || doc.segments[seg]?.title || "" } : undefined,
      caption,
      keywords,
      seed,
      mode: s.mode,
      card: sanitizeCard(s.card, caption) ?? fallbackCard(caption, keywords),
    };
  });
  if (shots.length === 0 && doc.lines.length) {
    shots.push({ shotId: "auto", kind: "placeholder", startMs: 0, endMs: durationMs, motion: "zoom-in", description: "", caption: "", keywords: [], seed: 1, card: { variant: "headline", headline: doc.brief.title || undefined } });
    issues.push({ level: "info", message: "还没有分镜，暂用一个占位画面" });
  }
  shots.forEach((s) => {
    if (s.kind === "upload" && !s.imageSrc) issues.push({ level: "warn", message: `有镜头选择了「${shotKindLabels.upload}」但还没上传图片` });
  });

  // 字幕
  const cues: Cue[] = doc.settings.subtitle.enabled ? laid.flatMap((l) => cuesForLine(l.id, lineById.get(l.id)!.text, l.chars, aspect, doc.settings.subtitle.highlight ? lineById.get(l.id)!.keywords : [])) : [];

  // 配乐
  const music: TimelineMusic[] = [];
  if (doc.settings.music.enabled) {
    const voiceIntervals = laid.filter((l) => !l.estimated || voice.length === 0).map((l) => ({ startMs: l.startMs, endMs: l.endMs }));
    const cues2 = doc.music.filter((c) => times.has(c.fromLineId) && times.has(c.toLineId));
    cues2.forEach((c, k) => {
      const track = art.tracks.get(c.trackId);
      if (!track) {
        issues.push({ level: "warn", message: `配乐曲目 ${c.trackId} 不在曲库中` });
        return;
      }
      const cross = 1500;
      const startMs = k === 0 ? 0 : Math.max(0, times.get(c.fromLineId)!.startMs - cross / 2);
      const endMs = k + 1 < cues2.length ? times.get(cues2[k + 1].fromLineId)!.startMs + cross / 2 : durationMs;
      if (endMs <= startMs) return;
      music.push({
        trackId: track.id,
        src: art.media(track.assetId),
        startMs,
        endMs,
        offsetMs: c.offsetMs,
        durationMs: track.durationMs,
        loop: endMs - startMs > track.durationMs - c.offsetMs,
        fadeInMs: k === 0 ? 800 : cross,
        fadeOutMs: k + 1 < cues2.length ? cross : 2500,
        envelope: duckEnvelope(voiceIntervals, startMs, endMs, doc.settings.music.ducking),
        baseGain: dbToGain(doc.settings.music.gainDb + (track.gainDb ?? 0)),
      });
    });
  }

  // 音效：章节转场「嗖」
  const sfx: TimelineSfx[] = [];
  if (doc.settings.sfx.enabled && art.sfx?.whoosh) {
    for (const s of shots) if (s.kind === "title" && s.startMs > 0) sfx.push({ src: art.sfx.whoosh, atMs: Math.max(0, s.startMs - 250), gain: 0.5 });
  }

  const pos = doc.settings.aiLabel.position;
  return {
    fps: FPS,
    width,
    height,
    aspect,
    durationMs,
    durationInFrames: Math.max(1, Math.ceil((durationMs / 1000) * FPS)),
    title: doc.brief.title,
    theme: themeOf(doc.visualStyle),
    voice,
    lines: laid.map((l) => ({ id: l.id, startMs: l.startMs, endMs: l.endMs, estimated: l.estimated, segmentIndex: l.segmentIndex })),
    shots,
    cues,
    music,
    sfx,
    subtitle: { enabled: doc.settings.subtitle.enabled && doc.settings.subtitle.burnIn, highlight: doc.settings.subtitle.highlight },
    aiLabel: { enabled: doc.settings.aiLabel.enabled, position: pos === "auto" ? (aspect === "9:16" ? "top-left" : "top-right") : pos },
    issues,
  };
}

/** 时间轴内容哈希：决定成片是否需要重新渲染（不含 issues） */
export function timelineHash(t: Timeline) {
  const { issues: _issues, ...rest } = t;
  void _issues;
  return quickHash(rest);
}
