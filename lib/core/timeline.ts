import { evenChars, contentCount } from "./align";
import { fallbackCard, sanitizeCard } from "./cards";
import { themeOf, type VideoTheme } from "./theme";
import { quickHash } from "./hash";
import type { TtsResult } from "./keys";
import { dbToGain, duckEnvelope, type Envelope } from "./mix";
import { anchorMs, sortShots, type LineTime } from "./shots";
import { cuesForLine, normalizeCues, type Cue } from "./subtitles";
import { isSecondaryUsable, type SubtitleBlock, type SubtitleConfig } from "./subtitle";
import { outputSpecs, shotKindLabels, animationSpecSchema, type AnimationFamily, type Aspect, type Card, type Line, type OutputSpec, type ProjectDoc, type ShotKind, type ShotMode, type Motion, type Ui2vTemplateId } from "./types";
import { outputSpecIdForAspect } from "./output-spec";
import { normalizeAnimation } from "./animation";
import { choreograph } from "./choreography";
import { defaultUi2vTemplateForShot } from "./ui2v";

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
  animation?: {
    family: AnimationFamily;
    templateId?: Ui2vTemplateId;
    intensity: 1 | 2 | 3;
    anchors: { frame: number; role: "enter" | "emphasis" | "exit"; target: string }[];
    params: Record<string, string | number | boolean>;
  };
  /** 转场重叠帧数；只扩展渲染区间，不改变音频和字幕时间。 */
  overlapInFrames?: number;
  overlapOutFrames?: number;
  transitionIn?: "cut" | "fade" | "wipe" | "whip" | "push" | "dissolve";
  safeArea?: { bottomRatio: number; sideRatio: number };
};


export type TimelineMusic = { trackId: string; src: string; startMs: number; endMs: number; offsetMs: number; durationMs: number; loop: boolean; fadeInMs: number; fadeOutMs: number; envelope: Envelope; baseGain: number };
export type TimelineSfx = { src: string; atMs: number; gain: number };

export type Timeline = {
  outputSpecId: "landscape-1080p" | "portrait-1080p";
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
  /** 烤录用字幕块（一句一块，含双语副行）；SRT 仍用 cues */
  subtitleBlocks: SubtitleBlock[];
  music: TimelineMusic[];
  sfx: TimelineSfx[];
  /** 完整字幕配置，见 lib/core/subtitle/types.ts */
  subtitle: SubtitleConfig;
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

/**
 * 排版折行后每行在原文中的起始索引 —— 纯函数，渲染层与测试共用。
 * formatter 折行会去掉用于断行的空白，不能按行长度累加（英文含空格时会整体漂移），
 * 所以从原文里逐行定位；找不到时退回上次结束位置。
 */
export function subtitleLineOffsets(text: string, lines: string[]): number[] {
  const offsets: number[] = [];
  let from = 0;
  for (const line of lines) {
    const at = line ? text.indexOf(line, from) : -1;
    const offset = at >= 0 ? at : from;
    offsets.push(offset);
    from = offset + line.length;
  }
  return offsets;
}

/**
 * Karaoke 逐字进度 —— 纯函数，渲染层与测试共用。
 * 有真实字级时间（charTimes，按 i 排序）时按「已读完（endMs <= ms）的最大字符索引 + 1」统计；
 * 缺失/不可信时回退整句均匀进度。结果 clamp 到 [0, text.length]，NaN/越界安全。
 */
/** 字级时间是否可信：索引有限、非负、严格递增且都在原文范围内（允许跳过标点） */
function usableCharTimes(chars: LineTime["chars"], textLength: number): boolean {
  if (chars.length === 0) return false;
  let prev = -1;
  for (const char of chars) {
    if (!Number.isFinite(char.i) || char.i < 0 || char.i >= textLength || char.i <= prev) return false;
    prev = char.i;
  }
  return true;
}

export function typedCharsAt(block: SubtitleBlock, ms: number): number {
  const length = Math.max(0, block.text.length);
  const charTimes = block.charTimes;
  if (charTimes && charTimes.length > 0) {
    let read = 0;
    for (const char of charTimes) {
      if (Number.isFinite(char.i) && Number.isFinite(char.endMs) && char.endMs <= ms) read = Math.max(read, char.i + 1);
    }
    return Math.min(length, read);
  }
  const span = Number.isFinite(block.startMs) && Number.isFinite(block.endMs) ? block.endMs - block.startMs : 0;
  const elapsed = Number.isFinite(block.startMs) && Number.isFinite(ms) ? ms - block.startMs : 0;
  const progress = span > 0 ? Math.min(1, Math.max(0, elapsed / span)) : 0;
  const typed = Math.floor(progress * length);
  return Math.min(length, Number.isFinite(typed) ? typed : 0);
}

export function buildTimeline(doc: ProjectDoc, art: Artifacts, aspectOrSpec: Aspect | OutputSpec): Timeline {
  const spec = typeof aspectOrSpec === "string" ? outputSpecs[outputSpecIdForAspect(aspectOrSpec)] : aspectOrSpec;
  const { aspect, width, height, fps } = spec;
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
  const profile = themeOf(doc.visualStyle).motion;
  const normalized = normalizeAnimation(doc.shots, doc.lines, times, profile);
  const sorted = sortShots(choreograph(normalized, doc.lines, times, profile), doc.lines);
  const transitionMs = themeOf(doc.visualStyle).motion.punchy ? 520 : 400;
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
    const variant = s.assetVariants?.[aspect];
    const assetId = variant?.assetId ?? s.assetId;
    if (s.assetId && !variant) issues.push({ level: s.importance >= 3 ? "warn" : "info", message: `镜头 ${s.id} 在${aspect}输出中使用共享素材，建议生成该画幅专用素材` });
    const transitionIn = s.transitionIn;
    const overlapInFrames = k > 0 && transitionIn && transitionIn !== "cut" ? Math.max(1, Math.round((transitionMs / 1000) * fps)) : 0;
    const overlapOutFrames = k + 1 < sorted.length && sorted[k + 1].transitionIn && sorted[k + 1].transitionIn !== "cut" ? Math.max(1, Math.round((transitionMs / 1000) * fps)) : 0;
    const parsedAnimation = s.animation ? animationSpecSchema.parse(s.animation) : undefined;
    const templateId = parsedAnimation?.templateId ?? defaultUi2vTemplateForShot(s);
    const animation = parsedAnimation || templateId ? {
      family: parsedAnimation?.family ?? "none",
      templateId,
      intensity: parsedAnimation?.intensity ?? 1,
      anchors: (parsedAnimation?.anchors ?? []).flatMap((a) => {
        const at = anchorMs({ lineId: a.lineId, char: a.char }, times);
        if (at === undefined || at < startMs || at >= endMs) return [];
        return [{ frame: Math.max(0, Math.round(((at - startMs) / 1000) * fps)), role: a.role, target: a.target }];
      }),
      params: parsedAnimation?.params ?? {},
    } : undefined;
    return {
      shotId: s.id,
      kind: s.kind,
      startMs,
      endMs,
      motion: s.motion,
      description: s.description,
      onScreenText: s.onScreenText,
      imageSrc: assetId && s.kind !== "video" ? art.media(assetId) : undefined,
      videoSrc: assetId && s.kind === "video" ? art.media(assetId) : undefined,
      focus: s.focus,
      chapter: s.kind === "title" ? { index: seg + 1, title: s.onScreenText || doc.segments[seg]?.title || "" } : undefined,
      caption,
      keywords,
      seed,
      mode: s.mode,
      card: sanitizeCard(s.card, caption) ?? fallbackCard(caption, keywords),
      animation,
      overlapInFrames,
      overlapOutFrames,
      transitionIn,
    };
  });
  if (shots.length === 0 && doc.lines.length) {
    shots.push({ shotId: "auto", kind: "placeholder", startMs: 0, endMs: durationMs, motion: "zoom-in", description: "", caption: "", keywords: [], seed: 1, card: { variant: "headline", headline: doc.brief.title || undefined }, animation: { family: "none", intensity: 1, anchors: [], params: {} } });
    issues.push({ level: "info", message: "还没有分镜，暂用一个占位画面" });
  }
  shots.forEach((s) => {
    if (s.kind === "upload" && !s.imageSrc) issues.push({ level: "warn", message: `有镜头选择了「${shotKindLabels.upload}」但还没上传图片` });
  });

  // 字幕：cues 负责断句与 SRT，subtitleBlocks 负责烤录排版（双语按句显示）
  const subtitle = doc.settings.subtitle;
  const rawCues: Cue[] = subtitle.enabled ? laid.flatMap((l) => cuesForLine(l.id, lineById.get(l.id)!.text, l.chars, aspect, subtitle.highlight ? lineById.get(l.id)!.keywords : [])) : [];
  // 全局收口：最短时长只是建议，cue 不得越过下一句的真实开始或媒体总时长
  const cues: Cue[] = normalizeCues(rawCues, durationMs);
  const subtitleBlocks: SubtitleBlock[] = subtitle.enabled
    ? laid.map((l) => {
        const line = lineById.get(l.id)!;
        // 逐句识别语言，混合语言稿不会用第一句的方向误判其他句
        const secondaryText = subtitle.bilingual && isSecondaryUsable(line) ? line.secondaryText?.trim() : undefined;
        const block: SubtitleBlock = {
          lineId: l.id,
          startMs: l.startMs,
          endMs: l.endMs,
          text: line.text,
          secondaryText,
          keywords: subtitle.highlight ? line.keywords : [],
        };
        // 非估算且索引可信时 Karaoke 用真实逐字时间。
        // 真实 TTS 的字级时间不含标点（索引是稀疏子集），只要单调且都在原文范围内即可，
        // 渲染端按「已读完的最大 i + 1」高亮，标点自然跟随前一个字。
        if (!l.estimated && usableCharTimes(l.chars, line.text.length)) {
          block.charTimes = l.chars.map((c) => ({ i: c.i, startMs: c.startMs, endMs: c.endMs })).sort((a, b) => a.i - b.i);
        }
        return block;
      })
    : [];
  shots.forEach((shot) => {
    shot.safeArea = subtitleBand(cues, shot, { portrait: aspect === "9:16" });
  });

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
    outputSpecId: spec.id,
    fps,
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
    subtitleBlocks,
    music,
    sfx,
    subtitle,
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

/** 内容哈希不包含动效和转场参数，改变动画时可复用已有内容渲染。 */
export function contentHash(t: Timeline) {
  const { issues: _issues, shots, theme: _theme, ...rest } = t;
  void _issues;
  const theme = { ..._theme, motion: undefined };
  const stableShots = shots.map((shot) => Object.fromEntries(Object.entries(shot).filter(([key]) => !["animation", "overlapInFrames", "overlapOutFrames", "transitionIn", "motion"].includes(key))));
  return quickHash({ ...rest, theme, shots: stableShots });
}

/** 仅由动效、转场和风格动效 token 组成的哈希。 */
export function animationHash(t: Timeline) {
  return quickHash({
    shots: t.shots.map((shot) => ({ shotId: shot.shotId, motion: shot.motion, animation: shot.animation, overlapInFrames: shot.overlapInFrames, overlapOutFrames: shot.overlapOutFrames, transitionIn: shot.transitionIn })),
    motion: t.theme.motion,
  });
}

/** 镜头覆盖区间内字幕占据的比例，渲染层据此计算动画安全区。 */
export function subtitleBand(cues: Cue[], shot: { startMs: number; endMs: number }, layout: { portrait: boolean }) {
  const active = cues.filter((cue) => cue.endMs > shot.startMs && cue.startMs < shot.endMs);
  if (!active.length) return { bottomRatio: 0, sideRatio: 0 };
  const maxLines = Math.max(1, Math.min(3, active.reduce((max, cue) => Math.max(max, Math.ceil(cue.text.length / (layout.portrait ? 12 : 16))), 1)));
  return { bottomRatio: layout.portrait ? 0.24 + Math.max(0, maxLines - 1) * 0.045 : 0.075 + Math.max(0, maxLines - 1) * 0.035, sideRatio: layout.portrait ? 0.07 : 0.04 };
}
