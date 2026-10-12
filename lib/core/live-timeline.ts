import { quickHash } from "./hash";
import { playbackAssetId } from "./shot-asset";
import { mediaUrl, type ProjectDoc } from "./types";
import { scoreTimelineSfx } from "./sfx";
import { assembleTimelineMusic, buildSubtitleBlocks, withFocusCaptions, withSubtitleSafeArea, type MusicSource, type Timeline, type TimelineShot } from "./timeline";

/**
 * 左侧预览用的时间轴。
 * 旁白和每句起止仍用服务端算好的底稿。字幕、配乐，以及刚选中的镜头画面，按浏览器里的文稿当场盖上去。
 * 这样换图不必等时间轴重算，也不必先渲染成片。
 */

function overlayShotMedia(shots: TimelineShot[], doc: ProjectDoc, aspect: Timeline["aspect"]): TimelineShot[] {
  const byId = new Map(doc.shots.map((shot) => [shot.id, shot]));
  return shots.map((shot) => {
    const source = byId.get(shot.shotId);
    if (!source || (source.kind !== "image" && source.kind !== "upload" && source.kind !== "video" && source.kind !== "stock")) return shot;
    const assetId = playbackAssetId(source, aspect);
    if (!assetId) return shot;
    const src = mediaUrl(assetId);
    if (source.kind === "video") return shot.videoSrc === src ? shot : { ...shot, videoSrc: src, imageSrc: undefined };
    return shot.imageSrc === src ? shot : { ...shot, imageSrc: src, videoSrc: undefined };
  });
}
export function applyLiveTimeline(base: Timeline, doc: ProjectDoc, tracks: MusicSource[]): Timeline {
  const subtitle = doc.settings.subtitle;
  const byId = new Map(doc.lines.map((line) => [line.id, line]));
  const subtitleBlocks = buildSubtitleBlocks(
    base.lines.map((line) => {
      const copy = byId.get(line.id);
      const previous = base.subtitleBlocks.find((block) => block.lineId === line.id);
      const chars = previous && copy && previous.text === copy.text ? previous.charTimes ?? [] : [];
      return { id: line.id, startMs: line.startMs, endMs: line.endMs, estimated: chars.length === 0, chars };
    }),
    (id) => byId.get(id),
    subtitle,
  );
  const known = new Map<string, MusicSource>();
  for (const track of tracks) known.set(track.id, track);
  for (const cue of base.music) {
    if (!known.has(cue.trackId)) known.set(cue.trackId, { id: cue.trackId, src: cue.src, durationMs: cue.durationMs });
  }
  const assembled = assembleTimelineMusic({
    enabled: doc.settings.music.enabled,
    gainDb: doc.settings.music.gainDb,
    ducking: doc.settings.music.ducking,
    cues: doc.music,
    lines: base.lines,
    durationMs: base.durationMs,
    voiceCount: base.voice.length,
    tracks: [...known.values()],
  });
  const shots = withFocusCaptions(withSubtitleSafeArea(overlayShotMedia(base.shots, doc, base.aspect), subtitle.enabled ? base.cues : [], subtitleBlocks, subtitle, base.width, base.height, base.aspect), doc, base.width);
  return {
    ...base,
    subtitle,
    subtitleBlocks,
    cues: subtitle.enabled ? base.cues : [],
    shots,
    music: assembled.music,
    sfx: doc.settings.sfx.enabled ? scoreTimelineSfx(shots, base.sfxSources) : [],
    issues: [
      ...base.issues.filter((item) => !item.message.startsWith("配乐曲目 ")),
      ...assembled.missingTrackIds.map((trackId) => ({ level: "warn" as const, message: `配乐曲目 ${trackId} 不在曲库中` })),
    ],
  };
}

/** 只包含字幕和配乐。句子、镜头、音色变了不算这一类。 */
export function presentationSignature(doc: ProjectDoc): string {
  return quickHash({
    subtitle: doc.settings.subtitle,
    music: doc.settings.music,
    cues: doc.music.map((cue) => [cue.trackId, cue.fromLineId, cue.toLineId, cue.offsetMs]),
  });
}

/**
 * 旁白、镜头和时间是否变了。
 * 只改字幕或配乐时，预览刷新不要把播放头拽回去。
 */
export function timelineStructureKey(timeline: Timeline): string {
  return quickHash({
    durationInFrames: timeline.durationInFrames,
    width: timeline.width,
    height: timeline.height,
    voice: timeline.voice.map((item) => [item.lineId, item.src, item.startMs, item.durationMs, item.trimStartMs]),
    shots: timeline.shots.map((shot) => [shot.shotId, shot.startMs, shot.endMs, shot.kind, shot.imageSrc ?? "", shot.videoSrc ?? ""]),
    lines: timeline.lines.map((line) => [line.id, line.startMs, line.endMs]),
  });
}
