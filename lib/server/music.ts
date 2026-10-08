import { promises as fs } from "fs";
import path from "path";
import type { MusicTrack } from "../core/timeline";
import { all, get, run } from "./db";
import { ffmpeg, loudnormFilter, measureLoudness, probe } from "./ffmpeg";
import { putFile, tempPath } from "./media";

/**
 * 曲库：bgm/ 里的音频就是全部曲目。启动时和打开配乐面板时扫描。
 * 用文件大小和修改时间做缓存，没变过的文件不重新探测、不重新转码。
 * 第一次见到的文件统一到 -20 LUFS，给人声留出空间。
 */

export const MUSIC_LUFS = -20;
export const MIN_TRACK_MS = 1_000;
export const MAX_TRACK_MS = 30 * 60_000;

const AUDIO_EXT = new Set([".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac", ".opus"]);

export const libraryDir = () => path.resolve(process.env.MUSIC_DIR || path.join(process.cwd(), "bgm"));

type Row = {
  id: string;
  title: string;
  file: string;
  source_sig: string;
  asset_hash: string;
  duration_ms: number;
  loudness: number | null;
};

export type LibraryTrack = MusicTrack & {
  file: string;
  loudness: number | null;
};

type AudioFile = { abs: string; id: string; title: string; size: number; mtimeMs: number };

const trackFromRow = (row: Row): LibraryTrack => ({
  id: row.id,
  title: row.title,
  file: row.file,
  assetId: row.asset_hash,
  durationMs: row.duration_ms,
  moods: [],
  loopable: true,
  loudness: row.loudness,
});

/** 已入库的曲目。时间轴用它找音频，不在这里扫磁盘。 */
export function listTracks(): LibraryTrack[] {
  return all<Row>("SELECT id, title, file, source_sig, asset_hash, duration_ms, loudness FROM music_tracks ORDER BY title").map(trackFromRow);
}

async function listAudio(root: string, rel = ""): Promise<AudioFile[]> {
  const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
  const out: AudioFile[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const id = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await listAudio(root, id)));
      continue;
    }
    if (!entry.isFile() || !AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    const abs = path.join(root, ...id.split("/"));
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat?.isFile()) continue;
    out.push({
      abs,
      id,
      title: path.basename(entry.name, path.extname(entry.name)),
      size: stat.size,
      mtimeMs: Math.round(stat.mtimeMs),
    });
  }
  return out;
}

function remember(file: AudioFile, sig: string, assetHash: string, durationMs: number, loudness: number | null) {
  run(
    `INSERT OR REPLACE INTO music_tracks
      (id, title, file, moods, loopable, license, source, source_sig, asset_hash, duration_ms, loudness, updated_at,
       author, license_url, source_page, download_url, attribution, commercial_use, rights_status, rights_checked_at,
       sha256, normalized_sha256, bpm, energy, instrumental, tags, disabled_reason, evidence)
     VALUES (?, ?, ?, '[]', 1, '', '', ?, ?, ?, ?, ?, '', '', '', '', '', NULL, 'folder', '', '', ?, NULL, NULL, NULL, '[]', '', '{}')`,
    file.id,
    file.title,
    file.id,
    sig,
    assetHash,
    durationMs,
    loudness,
    Date.now(),
    assetHash,
  );
}

export type ScanResult = { count: number; problems: string[]; tracks: LibraryTrack[] };

let scanning: Promise<ScanResult> | null = null;

/** 扫描曲库目录。同一进程里重叠的调用共用一次扫描。 */
export function scanLibrary(log: (...args: unknown[]) => void = () => {}): Promise<ScanResult> {
  if (!scanning) scanning = scanNow(log).finally(() => { scanning = null; });
  return scanning;
}

async function scanNow(log: (...args: unknown[]) => void): Promise<ScanResult> {
  const root = libraryDir();
  await fs.mkdir(root, { recursive: true });
  const files = await listAudio(root);
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const sig = `${file.size}:${file.mtimeMs}:${MUSIC_LUFS}`;
    const current = get<Row>("SELECT id, title, file, source_sig, asset_hash, duration_ms, loudness FROM music_tracks WHERE id = ?", file.id);
    if (current?.source_sig === sig && current.asset_hash && current.duration_ms > 0) {
      seen.add(file.id);
      continue;
    }

    const info = await probe(file.abs).catch(() => null);
    const durationMs = info?.durationMs ?? 0;
    const invalid = !info?.hasAudio || durationMs < MIN_TRACK_MS || durationMs > MAX_TRACK_MS;
    if (invalid) {
      const reason = !info?.hasAudio
        ? "无法识别为音频"
        : durationMs < MIN_TRACK_MS
          ? "短于 1 秒"
          : "长于 30 分钟";
      problems.push(`「${file.title}」${reason}，已跳过`);
      run("DELETE FROM music_tracks WHERE id = ?", file.id);
      continue;
    }

    try {
      log(`处理曲目「${file.title}」…`);
      const measured = await measureLoudness(file.abs, { i: MUSIC_LUFS, tp: -2, lra: 11 });
      const out = await tempPath("m4a");
      await ffmpeg(["-i", file.abs, "-vn", "-map_metadata", "-1", "-af", `${loudnormFilter(measured, { i: MUSIC_LUFS, tp: -2, lra: 11 })},aresample=48000`, "-ac", "2", "-c:a", "aac", "-b:a", "192k", out]);
      const asset = await putFile(out, { ext: "m4a", mime: "audio/mp4", meta: { source: "bgm-folder", trackId: file.id } });
      remember(file, sig, asset.hash, asset.durationMs ?? durationMs, measured.i);
      seen.add(file.id);
    } catch (error) {
      problems.push(`「${file.title}」处理失败：${error instanceof Error ? error.message : String(error)}`);
      run("DELETE FROM music_tracks WHERE id = ?", file.id);
    }
  }

  for (const row of all<{ id: string }>("SELECT id FROM music_tracks")) {
    if (!seen.has(row.id)) run("DELETE FROM music_tracks WHERE id = ?", row.id);
  }
  const tracks = listTracks();
  return { count: tracks.length, problems, tracks };
}

export function appAsset(name: string) {
  return get<{ asset_hash: string }>("SELECT asset_hash FROM app_assets WHERE name = ?", name)?.asset_hash;
}

/** 用 FFmpeg 合成一个转场「嗖」声（滤波白噪声 + 音量包络），不依赖外部素材 */
export async function ensureSfx() {
  if (appAsset("sfx.whoosh.v1")) return;
  const out = await tempPath("m4a");
  await ffmpeg([
    "-f", "lavfi", "-i", "anoisesrc=d=0.7:c=pink:a=0.6:r=48000",
    "-af", "highpass=f=500,lowpass=f=5000,afade=t=in:st=0:d=0.45:curve=exp,afade=t=out:st=0.45:d=0.25,volume=0.7",
    "-ac", "2", "-c:a", "aac", "-b:a", "128k", out,
  ]);
  const asset = await putFile(out, { ext: "m4a", mime: "audio/mp4", meta: { source: "builtin", name: "whoosh" } });
  run("INSERT OR REPLACE INTO app_assets (name, asset_hash, updated_at) VALUES (?, ?, ?)", "sfx.whoosh.v1", asset.hash, Date.now());
}
