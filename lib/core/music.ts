import type { Line, MusicCue } from "./types";

/**
 * 用户选定的一首曲子铺满当前全部句子。
 * 没有句子、或没有曲目时返回空，调用方不要另选一首。
 */
export function coverWithTrack(lines: Pick<Line, "id">[], trackId: string, offsetMs = 0): MusicCue[] {
  const first = lines[0]?.id;
  const last = lines.at(-1)?.id;
  if (!trackId || !first || !last) return [];
  return [{ trackId, fromLineId: first, toLineId: last, offsetMs, locked: true }];
}

/** 句子重排后保住已选曲目，并重新铺满。本来没选则保持为空。多段旧配乐收成第一首。 */
export function retargetMusic(music: MusicCue[], lines: Pick<Line, "id">[]): MusicCue[] {
  const chosen = music.find((cue) => cue.trackId);
  if (!chosen) return [];
  return coverWithTrack(lines, chosen.trackId, chosen.offsetMs);
}
