import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import type { MusicTrack } from "../core/timeline";
import { moods } from "../core/types";
import { all, get, json, parseJson, run } from "./db";
import { ffmpeg, loudnormFilter, measureLoudness } from "./ffmpeg";
import { putFile, tempPath } from "./media";

/**
 * 曲库：bgm/ 目录放音频，bgm/library.json 写清单（情绪、授权）。
 * 导入时统一响度到 -20 LUFS（给人声留出空间），转成素材存储；源文件没变就不重复处理。
 */

export const MUSIC_LUFS = -20;
export const libraryDir = () => path.resolve(process.env.MUSIC_DIR || path.join(process.cwd(), "bgm"));

const manifestSchema = z.object({
  tracks: z.array(
    z.object({
      id: z.string().regex(/^[\w-]+$/, "曲目 id 只能用字母、数字、横线"),
      file: z.string(),
      title: z.string(),
      moods: z.array(z.enum(moods)).min(1),
      loopable: z.boolean().default(true),
      license: z.string().default(""),
      source: z.string().default(""),
      gainDb: z.number().optional(),
    }),
  ),
});
export type ManifestTrack = z.infer<typeof manifestSchema>["tracks"][number];

type Row = { id: string; title: string; file: string; moods: string; loopable: number; license: string; source: string; source_sig: string; asset_hash: string; duration_ms: number; loudness: number | null };

export type LibraryTrack = MusicTrack & { license: string; source: string; loudness: number | null };

export function listTracks(): LibraryTrack[] {
  return all<Row>("SELECT * FROM music_tracks ORDER BY title").map((r) => ({
    id: r.id,
    title: r.title,
    assetId: r.asset_hash,
    durationMs: r.duration_ms,
    moods: parseJson(r.moods, []),
    loopable: !!r.loopable,
    license: r.license,
    source: r.source,
    loudness: r.loudness,
  }));
}

export async function readManifest() {
  const file = path.join(libraryDir(), "library.json");
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw === null) return { tracks: [] as ManifestTrack[], problems: [`没有找到曲库清单 ${file}`] };
  const parsed = manifestSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) return { tracks: [], problems: parsed.error.issues.map((i) => `library.json ${i.path.join(".")}：${i.message}`) };
  return { tracks: parsed.data.tracks, problems: [] as string[] };
}

/** 同步曲库：新增或改动的曲目重新处理，清单里删掉的曲目从库里移除 */
export async function syncLibrary(log: (...a: unknown[]) => void = () => {}) {
  const { tracks, problems } = await readManifest();
  const seen = new Set<string>();
  for (const t of tracks) {
    seen.add(t.id);
    const src = path.join(libraryDir(), t.file);
    const stat = await fs.stat(src).catch(() => null);
    if (!stat) {
      problems.push(`曲目 ${t.id} 的文件不存在：${t.file}`);
      continue;
    }
    if (!t.license || t.license.startsWith("待确认")) problems.push(`曲目「${t.title}」还没有填写授权来源`);
    const sig = `${stat.size}:${Math.round(stat.mtimeMs)}:${MUSIC_LUFS}`;
    const cur = get<Row>("SELECT * FROM music_tracks WHERE id = ?", t.id);
    if (cur && cur.source_sig === sig) {
      run("UPDATE music_tracks SET title = ?, moods = ?, loopable = ?, license = ?, source = ?, updated_at = ? WHERE id = ?", t.title, json(t.moods), t.loopable ? 1 : 0, t.license, t.source, Date.now(), t.id);
      continue;
    }
    log(`处理曲目「${t.title}」…`);
    const m = await measureLoudness(src, { i: MUSIC_LUFS, tp: -2, lra: 11 });
    const out = await tempPath("m4a");
    await ffmpeg(["-i", src, "-vn", "-map_metadata", "-1", "-af", `${loudnormFilter(m, { i: MUSIC_LUFS, tp: -2, lra: 11 })},aresample=48000`, "-ac", "2", "-c:a", "aac", "-b:a", "192k", out]);
    const asset = await putFile(out, { ext: "m4a", mime: "audio/mp4", meta: { source: "music-library", trackId: t.id, license: t.license } });
    run(
      `INSERT OR REPLACE INTO music_tracks (id, title, file, moods, loopable, license, source, source_sig, asset_hash, duration_ms, loudness, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      t.id,
      t.title,
      t.file,
      json(t.moods),
      t.loopable ? 1 : 0,
      t.license,
      t.source,
      sig,
      asset.hash,
      asset.durationMs ?? 0,
      m.i,
      Date.now(),
    );
  }
  for (const r of all<{ id: string }>("SELECT id FROM music_tracks")) if (!seen.has(r.id)) run("DELETE FROM music_tracks WHERE id = ?", r.id);
  return { count: seen.size, problems };
}

// ---------- 内置音效 ----------

export function appAsset(name: string) {
  return get<{ asset_hash: string }>("SELECT asset_hash FROM app_assets WHERE name = ?", name)?.asset_hash;
}

/** 用 FFmpeg 合成一个转场「嗖」声（滤波白噪声 + 音量包络），不依赖外部素材 */
export async function ensureSfx() {
  if (appAsset("sfx.whoosh.v1")) return;
  const out = await tempPath("m4a");
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=d=0.7:c=pink:a=0.6:r=48000",
    "-af",
    "highpass=f=500,lowpass=f=5000,afade=t=in:st=0:d=0.45:curve=exp,afade=t=out:st=0.45:d=0.25,volume=0.7",
    "-ac",
    "2",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    out,
  ]);
  const a = await putFile(out, { ext: "m4a", mime: "audio/mp4", meta: { source: "builtin", name: "whoosh" } });
  run("INSERT OR REPLACE INTO app_assets (name, asset_hash, updated_at) VALUES (?, ?, ?)", "sfx.whoosh.v1", a.hash, Date.now());
}
