import { evenChars, contentCount } from "./align";
import { fallbackCard, sanitizeCard } from "./cards";
import { themeOf, type VideoTheme } from "./theme";
import { quickHash } from "./hash";
import type { TtsResult } from "./keys";
import { dbToGain, duckEnvelope, type Envelope } from "./mix";
import { anchorMs, sortShots, type LineTime } from "./shots";
import { cuesForLine, normalizeCues, type Cue } from "./subtitles";
import { isSecondaryUsable, type SubtitleBlock, type SubtitleConfig } from "./subtitle";
import { outputSpecs, shotKindLabels, animationSpecSchema, type AnimationFamily, type Aspect, type Card, type Line, type OutputSpec, type ProjectDoc, type ShotKind, type ShotMode, type Motion, type LegacyTemplateId } from "./types";
import { outputSpecIdForAspect } from "./output-spec";
import { playbackAssetId } from "./shot-asset";
import { normalizeAnimation } from "./animation";
import { choreograph } from "./choreography";
import { inferCardTemplate, isActiveLegacyTemplate, isCodeCardShot } from "./legacy-templates";
import { compactKeywords, compactText } from "./text";
import { focusVisualWidth, normalizeFocusText, resolveFocusCaption, resolveFocusText } from "./focus";
import { scoreTimelineSfx, type SfxCue, type SfxSources } from "./sfx";
import { videoPlayback, type VideoArtifact } from "./video";

/**
 * 时间轴 —— 纯函数。输入 = 项目文档 + 机器产物（配音缓存、曲库），输出 = Remotion 的 inputProps。
 * 预览播放器、最终渲染、SRT 导出都读它，所见即所得。
 */

export const FPS = 30;
export const TIMING = { leadInMs: 500, tailMs: 1500, pauseInSegmentMs: 250, pauseBetweenSegmentsMs: 700 };
/** 重点文字多留在画面上的时间。只推迟下一镜出现，不改旁白和成片总长。 */
export const FOCUS_HOLD_MS = 500;
/** 被推迟的下一镜至少保留的画面时长。 */
export const FOCUS_NEXT_MIN_MS = 1000;

export type MusicTrack = { id: string; title: string; assetId: string; durationMs: number; moods: string[]; loopable: boolean; gainDb?: number };

export type TimelineVoice = { lineId: string; assetId?: string; src: string; startMs: number; durationMs: number; trimStartMs: number };
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
  videoTrimStartMs?: number;
  videoPlayableDurationMs?: number;
  videoHoldLastFrameMs?: number;
  videoSourceDurationMs?: number;
  videoSourceFps?: number;
  videoDurationReady?: boolean;
  focus?: { x: number; y: number };
  /** 章节标题卡：章节序号和标题 */
  chapter?: { index: number; title: string };
  /** 覆盖的句子原文（占位卡片显示用） */
  caption: string;
  keywords: string[];
  seed: number;
  mode?: ShotMode;
  /** 统一重点文字；旧项目由 card/onScreenText 兼容转换。 */
  focusText?: import("./types").FocusText;
  /** 虚焦逐词 / 墨线压印的英文小字。只在渲染时解析，不写回文稿。 */
  focusCaption?: string;
  /** 信息卡：大模型给的数据优先，没有时按旁白保守兜底（见 lib/core/cards.ts） */
  card: Card;
  animation?: {
    family: AnimationFamily;
    templateId?: LegacyTemplateId;
    intensity: 1 | 2 | 3;
    anchors: { frame: number; role: "enter" | "emphasis" | "exit"; target: string }[];
    params: Record<string, string | number | boolean>;
  };
  /** 转场重叠帧数；只扩展渲染区间，不改变音频和字幕时间。 */
  overlapInFrames?: number;
  overlapOutFrames?: number;
  transitionIn?: "cut" | "fade" | "wipe" | "whip" | "push" | "dissolve";
  safeArea?: { bottomRatio: number; sideRatio: number; topRatio?: number };
};


export type TimelineMusic = { trackId: string; src: string; startMs: number; endMs: number; offsetMs: number; durationMs: number; loop: boolean; fadeInMs: number; fadeOutMs: number; envelope: Envelope; baseGain: number };
export type TimelineSfx = SfxCue;

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
  /** 角色音效的文件地址。开关关上时 cue 为空，地址仍在，预览可以当场重新打开。 */
  sfxSources: SfxSources;
  /** 完整字幕配置，见 lib/core/subtitle/types.ts */
  subtitle: SubtitleConfig;
  aiLabel: { enabled: boolean; position: "top-left" | "top-right" };
  issues: { level: "info" | "warn"; message: string; lineId?: string }[];
};

export type Artifacts = {
  /** lineId → 配音结果 */
  tts: Map<string, TtsResult | undefined>;
  tracks: Map<string, MusicTrack>;
  sfx?: { sources: SfxSources };
  /** 实测语速（字/分钟）；没有时用 250 */
  charsPerMinute?: number;
  media: (hash: string) => string;
  /** Selected video assets, probed and loaded by the server; no I/O in core. */
  videos?: Map<string, VideoArtifact>;
};

function showsFocusText(shot: TimelineShot) {
  return !!shot.focusText && (shot.mode === "motion" || shot.kind === "title" || shot.kind === "quote");
}

/**
 * 重点文字的切点后移。字卡变长，下一镜变短，时间轴总长不变。
 * 下一镜至少留 1 秒，已经更短就不动；最后一个镜头不加。
 */
export function holdFocusTextShots(shots: TimelineShot[]): TimelineShot[] {
  const held = shots.map((shot) => ({ ...shot }));
  for (let index = 0; index < held.length - 1; index++) {
    if (!showsFocusText(held[index])) continue;
    const follower = held[index + 1];
    const hold = Math.min(FOCUS_HOLD_MS, Math.max(0, follower.endMs - follower.startMs - FOCUS_NEXT_MIN_MS));
    if (hold <= 0) continue;
    held[index] = { ...held[index], endMs: held[index].endMs + hold };
    const shift = Math.round((hold / 1000) * FPS);
    const animation = follower.animation;
    held[index + 1] = {
      ...follower,
      startMs: follower.startMs + hold,
      animation: animation ? { ...animation, anchors: animation.anchors.flatMap((anchor) => (anchor.frame < shift ? [] : [{ ...anchor, frame: anchor.frame - shift }])) } : animation,
    };
  }
  return held;
}

/** 两条居中排版的英文小字。预览和成片用同一判定，不写进保存的重点文字。 */
export function withFocusCaptions(shots: TimelineShot[], doc: Pick<ProjectDoc, "shots" | "lines" | "settings">, frameWidth: number): TimelineShot[] {
  const lineByShot = new Map(doc.shots.map((shot) => [shot.id, shot.at.lineId]));
  const lines = new Map(doc.lines.map((line) => [line.id, line]));
  return shots.map((shot) => {
    const focusCaption = resolveFocusCaption({
      presetId: shot.focusText?.presetId,
      bilingual: doc.settings.subtitle.bilingual,
      line: lines.get(lineByShot.get(shot.shotId) ?? ""),
      frameWidth,
    });
    if (focusCaption === shot.focusCaption) return shot;
    if (!focusCaption) {
      if (!shot.focusCaption) return shot;
      const next = { ...shot };
      delete next.focusCaption;
      return next;
    }
    return { ...shot, focusCaption };
  });
}

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

export type MusicSource = { id: string; src: string; durationMs: number; gainDb?: number };

type SubtitleLineCopy = { text: string; keywords?: string[]; secondaryText?: string; secondaryHash?: string };

type SubtitleLineTime = {
  id: string;
  startMs: number;
  endMs: number;
  estimated: boolean;
  chars: { i: number; startMs: number; endMs: number }[];
};

/** 一句一块的烤录字幕。字级时间只在可信时带上，Karaoke 否则按整句均匀推进。 */
export function buildSubtitleBlocks(lines: SubtitleLineTime[], lookup: (id: string) => SubtitleLineCopy | undefined, subtitle: SubtitleConfig): SubtitleBlock[] {
  if (!subtitle.enabled) return [];
  return lines.flatMap((line) => {
    const copy = lookup(line.id);
    if (!copy) return [];
    const secondaryText = subtitle.bilingual && isSecondaryUsable(copy) ? copy.secondaryText?.trim() : undefined;
    const block: SubtitleBlock = {
      lineId: line.id,
      startMs: line.startMs,
      endMs: line.endMs,
      text: copy.text,
      secondaryText,
      keywords: subtitle.highlight ? copy.keywords ?? [] : [],
    };
    if (!line.estimated && usableCharTimes(line.chars, copy.text.length)) {
      block.charTimes = line.chars.map((char) => ({ i: char.i, startMs: char.startMs, endMs: char.endMs })).sort((a, b) => a.i - b.i);
    }
    return [block];
  });
}

/** 按当前字幕块重算镜头安全区。烧录关闭时让出整幅画面。 */
export function withSubtitleSafeArea<T extends TimelineShot>(shots: T[], cues: Cue[], blocks: SubtitleBlock[], subtitle: SubtitleConfig, width: number, height: number, aspect: Aspect): T[] {
  return shots.map((shot) => {
    const next = { ...shot };
    next.safeArea = subtitleBand(cues, shot, { portrait: aspect === "9:16" });
    const active = subtitle.enabled && subtitle.burnIn ? blocks.filter((block) => block.endMs > shot.startMs && block.startMs < shot.endMs) : [];
    if (active.length) {
      const fontSize = subtitle.fontSize * width / 950;
      const maxLines = Math.max(...active.map((block) => Math.min(subtitle.maxLines, Math.ceil(focusVisualWidth(block.text) * fontSize / (width * subtitle.maxWidthRatio)))));
      const halfBand = (fontSize * (maxLines * 1.35 + (subtitle.bilingual ? 2.2 : 1.2)) / 2 + height * .025) / height;
      if (subtitle.positionY >= 50) next.safeArea.bottomRatio = Math.max(next.safeArea.bottomRatio, 1 - subtitle.positionY / 100 + halfBand);
      else {
        next.safeArea.bottomRatio = 0;
        next.safeArea.topRatio = subtitle.positionY / 100 + halfBand;
      }
    } else next.safeArea = { bottomRatio: 0, sideRatio: 0 };
    return next;
  });
}

/**
 * 把文稿里的配乐铺成时间轴音轨。
 * 预览和成片共用这一段，避免改音量或换曲时两边各算各的。
 */
export function assembleTimelineMusic(input: {
  enabled: boolean;
  gainDb: number;
  ducking: ProjectDoc["settings"]["music"]["ducking"];
  cues: { trackId: string; fromLineId: string; toLineId: string; offsetMs: number }[];
  lines: { id: string; startMs: number; endMs: number; estimated: boolean }[];
  durationMs: number;
  voiceCount: number;
  tracks: MusicSource[];
}): { music: TimelineMusic[]; missingTrackIds: string[] } {
  if (!input.enabled) return { music: [], missingTrackIds: [] };
  const times = new Map(input.lines.map((line) => [line.id, line]));
  const tracks = new Map(input.tracks.map((track) => [track.id, track]));
  const voiceIntervals = input.lines.filter((line) => !line.estimated || input.voiceCount === 0).map((line) => ({ startMs: line.startMs, endMs: line.endMs }));
  const cues = input.cues.filter((cue) => times.has(cue.fromLineId) && times.has(cue.toLineId));
  const music: TimelineMusic[] = [];
  const missingTrackIds: string[] = [];
  cues.forEach((cue, index) => {
    const track = tracks.get(cue.trackId);
    if (!track) {
      missingTrackIds.push(cue.trackId);
      return;
    }
    const cross = 1500;
    const startMs = index === 0 ? 0 : Math.max(0, times.get(cue.fromLineId)!.startMs - cross / 2);
    const endMs = index + 1 < cues.length ? times.get(cues[index + 1].fromLineId)!.startMs + cross / 2 : input.durationMs;
    if (endMs <= startMs) return;
    music.push({
      trackId: track.id,
      src: track.src,
      startMs,
      endMs,
      offsetMs: cue.offsetMs,
      durationMs: track.durationMs,
      loop: endMs - startMs > track.durationMs - cue.offsetMs,
      fadeInMs: index === 0 ? 800 : cross,
      fadeOutMs: index + 1 < cues.length ? cross : 2500,
      envelope: duckEnvelope(voiceIntervals, startMs, endMs, input.ducking),
      baseGain: dbToGain(input.gainDb + (track.gainDb ?? 0)),
    });
  });
  return { music, missingTrackIds };
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
    return [{ lineId: l.id, assetId: tts.assetId, src: art.media(tts.assetId), startMs: l.startMs - lead, durationMs: l.endMs - l.startMs + lead + tail, trimStartMs: tts.speechStartMs - lead }];
  });

  // 镜头
  const profile = themeOf(doc.visualStyle).motion;
  const videoPipeline = doc.settings.visualPipeline === "video";
  const normalized = videoPipeline ? doc.shots : normalizeAnimation(doc.shots, doc.lines, times, profile);
  const sorted = sortShots(videoPipeline ? normalized : choreograph(normalized, doc.lines, times, profile), doc.lines);
  const transitionMs = themeOf(doc.visualStyle).motion.punchy ? 520 : 400;
  const recentFocusPresets: import("./types").FocusPresetId[] = [];
  const shots: TimelineShot[] = sorted.map((s, k) => {
    const startMs = k === 0 ? 0 : (anchorMs(s.at, times) ?? 0);
    const endMs = k + 1 < sorted.length ? (anchorMs(sorted[k + 1].at, times) ?? durationMs) : durationMs;
    const coveredLaid = laid.filter((l) => l.endMs > startMs && l.startMs < endMs);
    const covered = coveredLaid.map((l) => lineById.get(l.id)!);
    // 只取在本镜头时间范围内说出的关键词（镜头可能从句中开始）
    const keywords = compactKeywords(coveredLaid.flatMap((l) => {
      const line = lineById.get(l.id)!;
      return line.keywords.filter((k) => {
        const i = line.text.indexOf(k);
        const c = l.chars.find((x) => x.i >= i);
        const at = c ? c.startMs : l.startMs;
        return at >= startMs - 50 && at < endMs;
      });
    }));
    const seg = lineById.get(s.at.lineId)?.segmentIndex ?? 0;
    const caption = covered.map((l) => l.text).join("");
    const seed = s.seed ?? parseInt(quickHash(s.id).slice(0, 6), 16);
    const assetId = playbackAssetId(s, aspect);
    if (s.assetId && !s.assetVariants?.[aspect]) issues.push({ level: s.importance >= 3 ? "warn" : "info", message: `镜头 ${s.id} 在${aspect}输出中使用共享素材，建议生成该画幅专用素材` });
    const transitionIn = videoPipeline ? "cut" : s.transitionIn;
    const overlapInFrames = k > 0 && transitionIn && transitionIn !== "cut" ? Math.max(1, Math.round((transitionMs / 1000) * fps)) : 0;
    const overlapOutFrames = !videoPipeline && k + 1 < sorted.length && sorted[k + 1].transitionIn && sorted[k + 1].transitionIn !== "cut" ? Math.max(1, Math.round((transitionMs / 1000) * fps)) : 0;
    const parsedAnimation = s.animation ? animationSpecSchema.parse(s.animation) : undefined;
    const card = sanitizeCard(s.card, caption) ?? fallbackCard(caption, keywords);
    const focusText = (s.mode === "motion" || s.kind === "title" || s.kind === "quote" || (s.kind === "video" && !!s.focusText))
      ? resolveFocusText(s, covered.flatMap((line) => line.keywords).filter((word) => !!normalizeFocusText(word)), caption, { seed, recentPresetIds: recentFocusPresets, palette: doc.motionPalette, startMs })
      : undefined;
    if (focusText?.presetId) {
      recentFocusPresets.push(focusText.presetId);
      if (recentFocusPresets.length > 3) recentFocusPresets.shift();
    }
    if (focusText && (focusVisualWidth(focusText.text) > 8 || focusVisualWidth(focusText.support ?? "") > 8)) {
      issues.push({ level: "warn", message: `镜头 ${s.id} 的重点文字超过 8 字宽，请概括后再渲染`, lineId: s.at.lineId });
    }
    const requestedTemplate = isActiveLegacyTemplate(parsedAnimation?.templateId) ? parsedAnimation.templateId : undefined;
    const templateId = isCodeCardShot(s) ? (requestedTemplate ?? inferCardTemplate({ ...s, card })) : undefined;
    const animation = templateId || parsedAnimation ? {
      family: "none" as const,
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
      motion: videoPipeline && s.kind === "video" ? "none" : s.motion,
      description: s.description,
      onScreenText: s.kind === "placeholder" && s.mode === "motion" ? compactText(focusText?.text ?? s.onScreenText) : s.onScreenText,
      imageSrc: assetId && s.kind !== "video" ? art.media(assetId) : undefined,
      videoSrc: assetId && s.kind === "video" ? art.media(assetId) : undefined,
      ...(s.kind === "video" ? videoPlayback(endMs - startMs, assetId ? art.videos?.get(assetId) : undefined) : {}),
      focus: s.focus,
      chapter: s.kind === "title" ? { index: seg + 1, title: doc.segments[seg]?.title || "" } : undefined,
      caption,
      keywords,
      seed,
      mode: videoPipeline && s.kind === "video" ? "generate" : s.mode,
      focusText,
      card,
      animation: videoPipeline && s.kind === "video" ? undefined : animation,
      overlapInFrames,
      overlapOutFrames,
      transitionIn,
    };
  });
  if (shots.length === 0 && doc.lines.length) {
    shots.push({ shotId: "auto", kind: "placeholder", startMs: 0, endMs: durationMs, motion: "zoom-in", description: "", caption: "", keywords: [], seed: 1, mode: "motion", focusText: { text: normalizeFocusText(doc.brief.title) || "待制作", layoutMode: "auto", presetId: "focus" }, card: { variant: "headline", headline: doc.brief.title || undefined }, animation: { family: "none", intensity: 1, anchors: [], params: {} } });
    issues.push({ level: "info", message: "还没有分镜，暂用一个占位画面" });
  }
  shots.forEach((s) => {
    if (s.kind === "upload" && !s.imageSrc) issues.push({ level: "warn", message: `有镜头选择了「${shotKindLabels.upload}」但还没上传图片` });
  });
  const timedShots = withFocusCaptions(videoPipeline ? shots : holdFocusTextShots(shots), doc, width);

  // 字幕：cues 负责断句与 SRT，subtitleBlocks 负责烤录排版（双语按句显示）
  const subtitle = doc.settings.subtitle;
  const rawCues: Cue[] = subtitle.enabled ? laid.flatMap((l) => cuesForLine(l.id, lineById.get(l.id)!.text, l.chars, aspect, subtitle.highlight ? lineById.get(l.id)!.keywords : [])) : [];
  // 全局收口：最短时长只是建议，cue 不得越过下一句的真实开始或媒体总时长
  const cues: Cue[] = normalizeCues(rawCues, durationMs);
  const subtitleBlocks = buildSubtitleBlocks(laid, (id) => lineById.get(id), subtitle);
  const framedShots = withSubtitleSafeArea(timedShots, cues, subtitleBlocks, subtitle, width, height, aspect);

  // 配乐
  const assembled = assembleTimelineMusic({
    enabled: doc.settings.music.enabled,
    gainDb: doc.settings.music.gainDb,
    ducking: doc.settings.music.ducking,
    cues: doc.music,
    lines: laid,
    durationMs,
    voiceCount: voice.length,
    tracks: [...art.tracks.values()].map((track) => ({ id: track.id, src: art.media(track.assetId), durationMs: track.durationMs, gainDb: track.gainDb })),
  });
  for (const trackId of assembled.missingTrackIds) issues.push({ level: "warn", message: `配乐曲目 ${trackId} 不在曲库中` });
  const music = assembled.music;

  const sfxSources = art.sfx?.sources ?? {};
  const sfx = doc.settings.sfx.enabled ? scoreTimelineSfx(framedShots, sfxSources) : [];

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
    shots: framedShots,
    cues,
    subtitleBlocks,
    music,
    sfx,
    sfxSources,
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
  const { issues: _issues, shots, theme: _theme, sfx: _sfx, sfxSources: _sfxSources, ...rest } = t;
  void _issues;
  void _sfx;
  void _sfxSources;
  const theme = { ..._theme, motion: undefined };
  const stableShots = shots.map((shot) => Object.fromEntries(Object.entries(shot).filter(([key]) => !["animation", "overlapInFrames", "overlapOutFrames", "transitionIn", "motion"].includes(key))));
  return quickHash({ ...rest, theme, shots: stableShots });
}

/** 仅由动效、转场和风格动效 token 组成的哈希。 */
export function animationHash(t: Timeline) {
  return quickHash({
    shots: t.shots.map((shot) => ({ shotId: shot.shotId, motion: shot.motion, animation: shot.animation, focusText: shot.focusText, ...(shot.focusCaption ? { focusCaption: shot.focusCaption } : {}), overlapInFrames: shot.overlapInFrames, overlapOutFrames: shot.overlapOutFrames, transitionIn: shot.transitionIn })),
    motion: t.theme.motion,
    sfx: t.sfx,
  });
}

/** 镜头覆盖区间内字幕占据的比例，渲染层据此计算动画安全区。 */
export function subtitleBand(cues: Cue[], shot: { startMs: number; endMs: number }, layout: { portrait: boolean }) {
  const active = cues.filter((cue) => cue.endMs > shot.startMs && cue.startMs < shot.endMs);
  if (!active.length) return { bottomRatio: 0, sideRatio: 0 };
  const maxLines = Math.max(1, Math.min(3, active.reduce((max, cue) => Math.max(max, Math.ceil(cue.text.length / (layout.portrait ? 12 : 16))), 1)));
  return { bottomRatio: layout.portrait ? 0.24 + Math.max(0, maxLines - 1) * 0.045 : 0.075 + Math.max(0, maxLines - 1) * 0.035, sideRatio: layout.portrait ? 0.07 : 0.04 };
}
