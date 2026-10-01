import { promises as fs } from "fs";
import path from "path";
import { all, dataDir, get, run, tx } from "./db";
import { mediaPath, mediaRoot } from "./media";

/**
 * 数据目录维护：统计占用、清理打包/临时缓存、回收无引用素材、彻底删除回收站项目。
 * 素材按内容哈希共享，不能按项目直接删文件；只能先移除引用，再按可达性回收。
 */

const DAY = 86_400_000;

/** 软删除项目在回收站保留多久，之后由定期维护自动彻底删除 */
export const TRASH_RETENTION_MS = 30 * DAY;

export type CleanResult = { removed: number; freedBytes: number };
export type PurgeResult = { projects: number; rows: Record<string, number> };

export type GcResult = CleanResult & { cacheRows: number };

export type MaintenanceResult = { trash: PurgeResult; bundles: CleanResult; temp: CleanResult; probes: CleanResult; gc: GcResult };

const HEX64 = /[a-f0-9]{64}/g;

function addHashes(text: string | null | undefined, out: Set<string>) {
  if (!text) return;
  for (const m of text.matchAll(HEX64)) out.add(m[0]);
}

function chunksOf<T>(items: T[], size = 400): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(",");

/**
 * 所有仍被引用的素材 hash。
 * 包括回收站里的项目和全部版本快照，因为它们都还能恢复。
 * cache 不算引用：缓存是可重建的加速层，回收素材时会同步失效相关缓存行。
 */
export function reachableHashes(): Set<string> {
  const out = new Set<string>();
  for (const r of all<{ doc: string }>("SELECT doc FROM projects")) addHashes(r.doc, out);
  for (const r of all<{ doc: string }>("SELECT doc FROM project_versions")) addHashes(r.doc, out);
  for (const r of all<{ video_hash: string; srt_hash: string | null }>("SELECT video_hash, srt_hash FROM renders")) {
    addHashes(r.video_hash, out);
    addHashes(r.srt_hash, out);
  }
  for (const r of all<{ asset_hash: string }>("SELECT asset_hash FROM music_tracks UNION ALL SELECT asset_hash FROM app_assets")) addHashes(r.asset_hash, out);
  for (const r of all<{ result: string }>("SELECT result FROM tts_takes")) addHashes(r.result, out);
  for (const r of all<{ input: string; result: string | null }>("SELECT input, result FROM jobs WHERE status IN ('queued', 'running')")) {
    addHashes(r.input, out);
    addHashes(r.result, out);
  }
  return out;
}

const PROJECT_TABLES = ["renders", "jobs", "generation_runs", "project_versions", "project_goals", "voice_changes", "tts_takes"] as const;

/** 彻底删除项目及其关联数据；只处理已进回收站的项目，避免误删在用项目。ledger 保留作费用记录 */
export function purgeProjects(ids: string[]): PurgeResult {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { projects: 0, rows: {} };
  return tx(() => {
    // 只对确实处于回收站的项目级联删除，传错 id 时不会误删在用项目的任务和成片记录
    const deletable: string[] = [];
    for (const chunk of chunksOf(unique)) deletable.push(...all<{ id: string }>(`SELECT id FROM projects WHERE deleted_at IS NOT NULL AND id IN (${placeholders(chunk.length)})`, ...chunk).map((r) => r.id));
    if (deletable.length === 0) return { projects: 0, rows: {} };
    const rows: Record<string, number> = {};
    for (const table of PROJECT_TABLES) {
      let n = 0;
      for (const chunk of chunksOf(deletable)) n += Number(run(`DELETE FROM ${table} WHERE project_id IN (${placeholders(chunk.length)})`, ...chunk).changes);
      if (n > 0) rows[table] = n;
    }
    let projects = 0;
    for (const chunk of chunksOf(deletable)) projects += Number(run(`DELETE FROM projects WHERE id IN (${placeholders(chunk.length)})`, ...chunk).changes);
    return { projects, rows };
  });
}

/** 清空回收站；olderThanMs > 0 时只清理进回收站超过该时长的项目 */
export function purgeTrash(olderThanMs = 0): PurgeResult {
  const ids = all<{ id: string }>("SELECT id FROM projects WHERE deleted_at IS NOT NULL AND deleted_at <= ?", Date.now() - olderThanMs).map((r) => r.id);
  return purgeProjects(ids);
}

export async function dirUsage(dir: string): Promise<{ bytes: number; files: number }> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let bytes = 0;
  let files = 0;
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = await dirUsage(full);
      bytes += sub.bytes;
      files += sub.files;
    } else {
      const st = await fs.stat(full).catch(() => null);
      if (st) {
        bytes += st.size;
        files += 1;
      }
    }
  }
  return { bytes, files };
}

export type PruneBundlesOptions = { keep?: number; minAgeMs?: number; keepSigs?: Iterable<string> };

/** 清理旧打包缓存：保留最近 keep 个，keepSigs 里是渲染进程正在使用的签名，一律保留 */
export async function pruneBundles(opts: PruneBundlesOptions = {}): Promise<CleanResult> {
  const keep = opts.keep ?? 2;
  const minAge = opts.minAgeMs ?? DAY;
  const keepSigs = new Set(opts.keepSigs ?? []);
  const root = path.join(dataDir(), "bundles");
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs: { name: string; full: string; mtimeMs: number }[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(root, e.name);
    const st = await fs.stat(full).catch(() => null);
    if (st) dirs.push({ name: e.name, full, mtimeMs: st.mtimeMs });
  }
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let removed = 0;
  let freedBytes = 0;
  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i];
    if (i < keep || keepSigs.has(dir.name)) continue;
    if (Date.now() - dir.mtimeMs < minAge) continue;
    const usage = await dirUsage(dir.full);
    await fs.rm(dir.full, { recursive: true, force: true });
    removed += 1;
    freedBytes += usage.bytes;
  }
  return { removed, freedBytes };
}

/** 删除目录中最后修改早于 olderThanMs 的条目（文件或子目录） */
export async function prunePath(dir: string, olderThanMs: number): Promise<CleanResult> {
  const cutoff = Date.now() - olderThanMs;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  let freedBytes = 0;
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const st = await fs.stat(full).catch(() => null);
    if (!st || st.mtimeMs > cutoff) continue;
    const usage = e.isDirectory() ? await dirUsage(full) : { bytes: st.size, files: 1 };
    await fs.rm(full, { recursive: true, force: true });
    removed += 1;
    freedBytes += usage.bytes;
  }
  return { removed, freedBytes };
}

export const pruneTemp = (olderThanMs = DAY) => prunePath(path.join(dataDir(), "tmp"), olderThanMs);
export const pruneProbes = (olderThanMs = 7 * DAY) => prunePath(path.join(dataDir(), "tts-probes"), olderThanMs);

/** 回收没有任何存活引用的素材文件和记录；宽限期内不动，避开「刚生成还没写回文档」的竞态 */
export async function gcOrphanAssets(opts: { graceMs?: number } = {}): Promise<GcResult> {
  const keep = reachableHashes();
  const cutoff = Date.now() - (opts.graceMs ?? DAY);
  const orphans = all<{ hash: string; ext: string; bytes: number }>("SELECT hash, ext, bytes FROM assets WHERE created_at < ?", cutoff).filter((r) => !keep.has(r.hash));
  const gone = new Set<string>();
  let freedBytes = 0;
  for (const r of orphans) {
    const file = mediaPath(r.hash, r.ext);
    await fs.rm(file, { force: true });
    await fs.rmdir(path.dirname(file)).catch(() => {});
    await fs.rmdir(path.join(mediaRoot(), r.hash.slice(0, 2))).catch(() => {});
    gone.add(r.hash);
    freedBytes += r.bytes;
  }
  if (gone.size === 0) return { removed: 0, freedBytes: 0, cacheRows: 0 };
  const { assets, cacheRows } = tx(() => {
    let a = 0;
    for (const chunk of chunksOf([...gone])) a += Number(run(`DELETE FROM assets WHERE hash IN (${placeholders(chunk.length)})`, ...chunk).changes);
    // 缓存行可能还指向刚被回收的素材；一并失效，避免命中缓存后拿到 404 地址
    let c = 0;
    const seen = new Set<string>();
    for (const row of all<{ key: string; result: string }>("SELECT key, result FROM cache")) {
      seen.clear();
      addHashes(row.result, seen);
      for (const h of seen) {
        if (gone.has(h)) {
          run("DELETE FROM cache WHERE key = ?", row.key);
          c += 1;
          break;
        }
      }
    }
    return { assets: a, cacheRows: c };
  });
  return { removed: assets, freedBytes, cacheRows };
}

export type StorageDir = { key: string; label: string; bytes: number; files: number };
export type TrashItem = { id: string; title: string; deletedAt: number };
export type StorageUsage = {
  dirs: StorageDir[];
  dbBytes: number;
  assets: { count: number; bytes: number };
  trash: TrashItem[];
};

export async function storageUsage(): Promise<StorageUsage> {
  const base = dataDir();
  const specs = [
    { key: "media", label: "素材库", dir: mediaRoot() },
    { key: "bundles", label: "渲染打包缓存", dir: path.join(base, "bundles") },
    { key: "tmp", label: "临时文件", dir: path.join(base, "tmp") },
    { key: "probes", label: "TTS 探测样本", dir: path.join(base, "tts-probes") },
  ];
  const dirs: StorageDir[] = [];
  for (const spec of specs) dirs.push({ key: spec.key, label: spec.label, ...(await dirUsage(spec.dir)) });
  let dbBytes = 0;
  for (const name of ["app.db", "app.db-wal", "app.db-shm"]) dbBytes += (await fs.stat(path.join(base, name)).catch(() => null))?.size ?? 0;
  const assetRow = get<{ count: number; bytes: number | null }>("SELECT COUNT(*) AS count, SUM(bytes) AS bytes FROM assets")!;
  const trash = all<{ id: string; title: string; deleted_at: number }>("SELECT id, title, deleted_at FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").map((r) => ({
    id: r.id,
    title: r.title || "未命名项目",
    deletedAt: r.deleted_at,
  }));
  return { dirs, dbBytes, assets: { count: assetRow.count, bytes: assetRow.bytes ?? 0 }, trash };
}

/** 定期维护：过期回收站 → 孤儿素材 → 打包缓存与临时文件。keepSigs 由渲染层提供，保护正在使用的打包缓存 */
export async function runMaintenance(opts: { bundleKeepSigs?: Iterable<string> } = {}): Promise<MaintenanceResult> {
  const trash = purgeTrash(TRASH_RETENTION_MS);
  const gc = await gcOrphanAssets();
  const bundles = await pruneBundles({ keepSigs: opts.bundleKeepSigs });
  const temp = await pruneTemp();
  const probes = await pruneProbes();
  return { trash, bundles, temp, probes, gc };
}
