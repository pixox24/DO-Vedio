import { createHash } from "crypto";
import { createReadStream, promises as fs } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import type { MusicTrack } from "../core/timeline";
import {
  assessLicense,
  isUsableTrack,
  manifestTrackProblems,
  musicManifestSchema,
  type LicenseEvidence,
  type ManifestTrack,
  type MusicEnergy,
  type RightsStatus,
} from "../core/music-library";
import { all, get, json, parseJson, run } from "./db";
import { ffmpeg, loudnormFilter, measureLoudness, probe } from "./ffmpeg";
import { putFile, tempPath } from "./media";

/**
 * 曲库：bgm/ 目录放音频，bgm/library.json 写清单（情绪、授权、来源、哈希）。
 * 导入时统一响度到 -20 LUFS（给人声留出空间），转成素材存储；源文件没变就不重复处理。
 * 授权未核实的曲目仍会入库并可在面板中试听，但不会参与自动选曲（见 listUsableTracks）。
 */

export const MUSIC_LUFS = -20;
export const MIN_TRACK_MS = 5_000;
export const MAX_TRACK_MS = 20 * 60_000;
export const MIN_SAMPLE_RATE = 22_050;

export const libraryDir = () => path.resolve(process.env.MUSIC_DIR || path.join(process.cwd(), "bgm"));

type Row = {
  id: string;
  title: string;
  file: string;
  moods: string;
  loopable: number;
  license: string;
  source: string;
  source_sig: string;
  asset_hash: string;
  duration_ms: number;
  loudness: number | null;
  author: string;
  license_url: string;
  source_page: string;
  download_url: string;
  attribution: string;
  commercial_use: number | null;
  rights_status: string;
  rights_checked_at: string;
  sha256: string;
  normalized_sha256: string;
  bpm: number | null;
  energy: string | null;
  instrumental: number | null;
  tags: string;
  disabled_reason: string;
  evidence: string;
};

export type LibraryTrack = MusicTrack & {
  file: string;
  license: string;
  source: string;
  loudness: number | null;
  author: string;
  licenseUrl: string;
  sourcePage: string;
  downloadUrl: string;
  attribution: string;
  commercialUse: boolean | null;
  rightsStatus: RightsStatus;
  rightsCheckedAt: string;
  sha256: string;
  normalizedSha256: string;
  bpm: number | null;
  energy: MusicEnergy | null;
  instrumental: boolean | null;
  tags: string[];
  disabledReason: string;
  evidence: LicenseEvidence | null;
  /** 已核实且未被禁用，可参与自动选曲 */
  usable: boolean;
};

const trackFromRow = (r: Row): LibraryTrack => ({
  id: r.id,
  title: r.title,
  assetId: r.asset_hash,
  durationMs: r.duration_ms,
  moods: parseJson<string[]>(r.moods, []),
  loopable: !!r.loopable,
  license: r.license,
  source: r.source,
  loudness: r.loudness,
  file: r.file,
  author: r.author,
  licenseUrl: r.license_url,
  sourcePage: r.source_page,
  downloadUrl: r.download_url,
  attribution: r.attribution,
  commercialUse: r.commercial_use === null ? null : !!r.commercial_use,
  rightsStatus: (r.rights_status || "pending") as RightsStatus,
  rightsCheckedAt: r.rights_checked_at,
  sha256: r.sha256,
  normalizedSha256: r.normalized_sha256,
  bpm: r.bpm,
  energy: (r.energy || null) as MusicEnergy | null,
  instrumental: r.instrumental === null ? null : !!r.instrumental,
  tags: parseJson<string[]>(r.tags, []),
  disabledReason: r.disabled_reason,
  evidence: parseJson<LicenseEvidence | null>(r.evidence, null),
  usable: isUsableTrack({ rightsStatus: (r.rights_status || "pending") as RightsStatus, disabledReason: r.disabled_reason }),
});

/** 全部曲目（含待核实），供曲库面板展示与历史项目回放 */
export function listTracks(): LibraryTrack[] {
  return all<Row>("SELECT * FROM music_tracks ORDER BY title").map(trackFromRow);
}

/** 仅已核实且未禁用的曲目，供自动选曲 */
export function listUsableTracks(): LibraryTrack[] {
  return all<Row>("SELECT * FROM music_tracks WHERE rights_status = 'verified' AND disabled_reason = '' ORDER BY title").map(trackFromRow);
}

export async function readManifest(): Promise<{ tracks: ManifestTrack[]; problems: string[] }> {
  const file = path.join(libraryDir(), "library.json");
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (raw === null) return { tracks: [], problems: [`没有找到曲库清单 ${file}`] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { tracks: [], problems: [`library.json 不是合法 JSON：${(e as Error).message}`] };
  }
  const parsed = musicManifestSchema.safeParse(data);
  if (!parsed.success) {
    return { tracks: [], problems: parsed.error.issues.map((i) => `library.json ${i.path.join(".")}：${i.message}`) };
  }
  return { tracks: parsed.data.tracks, problems: [] };
}

async function sha256File(file: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

export type SyncTrackOutcome = {
  id: string;
  title: string;
  /** duplicate = 原始文件或规范化文件与已有曲目相同，未入库 */
  status: RightsStatus | "duplicate";
  reasons: string[];
  sourceUrl: string;
  sha256: string;
};

export type SyncReport = {
  accepted: number;
  pending: number;
  rejected: number;
  quarantine: number;
  duplicate: number;
  missingLicense: number;
  invalidAudio: number;
  tracks: SyncTrackOutcome[];
};

/**
 * strict 模式下必须失败的问题：文件缺失/损坏、声称已核实但证据不足、重复文件。
 * 授权完全未核实（pending）只报告，不阻断导入——它们不会参与选曲。
 */
export function strictProblems(report: SyncReport): string[] {
  return report.tracks
    .filter((t) => t.status === "quarantine" || t.status === "duplicate" || t.reasons.some((r) => r.includes("声称已核实") || r.includes("不能标记为已核实")))
    .map((t) => `${t.title}（${t.id}）：${t.reasons.join("；") || t.status}`);
}

function upsertRow(row: {
  track: ManifestTrack;
  rightsStatus: RightsStatus;
  reasons: string[];
  sha256: string;
  sig: string;
  assetHash: string;
  normalizedSha256: string;
  durationMs: number;
  loudness: number | null;
}) {
  const t = row.track;
  run(
    `INSERT OR REPLACE INTO music_tracks
      (id, title, file, moods, loopable, license, source, source_sig, asset_hash, duration_ms, loudness, updated_at,
       author, license_url, source_page, download_url, attribution, commercial_use, rights_status, rights_checked_at,
       sha256, normalized_sha256, bpm, energy, instrumental, tags, disabled_reason, evidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    t.id,
    t.title,
    t.file,
    json(t.moods),
    t.loopable ? 1 : 0,
    t.license,
    t.source,
    row.sig,
    row.assetHash,
    row.durationMs,
    row.loudness,
    Date.now(),
    t.author,
    t.licenseUrl,
    t.sourcePage,
    t.downloadUrl,
    t.attribution,
    t.commercialUse === null ? null : t.commercialUse ? 1 : 0,
    row.rightsStatus,
    t.rightsCheckedAt,
    row.sha256,
    row.normalizedSha256,
    t.bpm,
    t.energy,
    t.instrumental === null ? null : t.instrumental ? 1 : 0,
    json(t.tags),
    row.reasons.join("；"),
    json(t.evidence ?? null),
  );
}

/** 同步曲库：新增或改动的曲目重新处理，清单里删掉的曲目从库里移除 */
export async function syncLibrary(log: (...a: unknown[]) => void = () => {}): Promise<{ count: number; problems: string[]; report: SyncReport }> {
  const { tracks, problems } = await readManifest();
  const report: SyncReport = { accepted: 0, pending: 0, rejected: 0, quarantine: 0, duplicate: 0, missingLicense: 0, invalidAudio: 0, tracks: [] };
  const seen = new Set<string>();
  const bySha = new Map<string, string>();
  const byNormalized = new Map<string, string>();

  for (const t of tracks) {
    seen.add(t.id);
    const verdict = assessLicense(t);
    const rightsStatus = verdict.status;
    const trackProblems = [...verdict.reasons];
    if (t.rightsStatus === "verified" && rightsStatus !== "verified") {
      trackProblems.push("清单声称已核实，但证据不足，已降级为待核实");
      problems.push(`曲目「${t.title}」清单声称已核实，但证据不足，已降级为待核实`);
    }
    for (const p of manifestTrackProblems(t)) if (!trackProblems.includes(p)) trackProblems.push(p);
    if (t.disabledReason) trackProblems.push(t.disabledReason);

    const outcome: SyncTrackOutcome = { id: t.id, title: t.title, status: rightsStatus, reasons: [...trackProblems], sourceUrl: t.sourcePage || t.downloadUrl || t.source, sha256: "" };

    const src = path.join(libraryDir(), t.file);
    const stat = await fs.stat(src).catch(() => null);
    if (!stat) {
      const reason = `文件不存在：${t.file}`;
      problems.push(`曲目 ${t.id} 的${reason}`);
      trackProblems.push(reason);
      outcome.status = "quarantine";
      outcome.reasons = trackProblems;
      report.quarantine++;
      upsertRow({ track: t, rightsStatus: "quarantine", reasons: trackProblems, sha256: "", sig: "", assetHash: "", normalizedSha256: "", durationMs: 0, loudness: null });
      report.tracks.push(outcome);
      continue;
    }

    const sha = await sha256File(src);
    outcome.sha256 = sha;
    const previousId = bySha.get(sha);
    if (previousId) {
      const reason = `与曲目 ${previousId} 的原始文件重复（sha256 ${sha.slice(0, 12)}…）`;
      problems.push(`曲目「${t.title}」${reason}`);
      outcome.status = "duplicate";
      outcome.reasons = [reason];
      report.duplicate++;
      run("DELETE FROM music_tracks WHERE id = ?", t.id);
      report.tracks.push(outcome);
      continue;
    }
    bySha.set(sha, t.id);

    const info = await probe(src).catch(() => null);
    const invalid =
      !info || !info.hasAudio || info.hasVideo || !info.durationMs || info.durationMs < MIN_TRACK_MS || info.durationMs > MAX_TRACK_MS;
    if (invalid) {
      const reason = !info
        ? "ffprobe 无法识别音频"
        : !info.hasAudio
          ? "文件中没有音频流"
          : info.hasVideo
            ? "文件包含视频流，不是纯音频"
            : !info.durationMs || info.durationMs < MIN_TRACK_MS
              ? `音频过短（${info.durationMs ?? 0}ms < ${MIN_TRACK_MS}ms）`
              : `音频过长（${info.durationMs}ms > ${MAX_TRACK_MS}ms）`;
      problems.push(`曲目「${t.title}」未通过音频校验：${reason}`);
      trackProblems.push(reason);
      outcome.status = "quarantine";
      outcome.reasons = trackProblems;
      report.quarantine++;
      report.invalidAudio++;
      upsertRow({ track: t, rightsStatus: "quarantine", reasons: trackProblems, sha256: sha, sig: "", assetHash: "", normalizedSha256: sha, durationMs: 0, loudness: null });
      report.tracks.push(outcome);
      continue;
    }

    if (rightsStatus === "rejected" || rightsStatus === "quarantine") {
      // 已排除/隔离的曲目保留元数据供审计，但不做重编码、不占用媒体存储。
      if (!trackProblems.length) trackProblems.push(t.disabledReason || (rightsStatus === "rejected" ? "授权已排除" : "已被隔离"));
      outcome.reasons = trackProblems;
      report[rightsStatus]++;
      upsertRow({ track: t, rightsStatus, reasons: trackProblems, sha256: sha, sig: `${rightsStatus}:${sha}:${MUSIC_LUFS}`, assetHash: "", normalizedSha256: sha, durationMs: info.durationMs ?? 0, loudness: null });
      report.tracks.push(outcome);
      continue;
    }

    const sig = `${sha}:${MUSIC_LUFS}`;
    const cur = get<Row>("SELECT * FROM music_tracks WHERE id = ?", t.id);
    const metadataOnly = cur && cur.source_sig === sig && cur.asset_hash;
    if (metadataOnly) {
      run(
        `UPDATE music_tracks SET title = ?, moods = ?, loopable = ?, license = ?, source = ?, author = ?, license_url = ?, source_page = ?,
           download_url = ?, attribution = ?, commercial_use = ?, rights_status = ?, rights_checked_at = ?, bpm = ?, energy = ?, instrumental = ?,
           tags = ?, disabled_reason = ?, evidence = ?, normalized_sha256 = ?, sha256 = ?, updated_at = ? WHERE id = ?`,
        t.title,
        json(t.moods),
        t.loopable ? 1 : 0,
        t.license,
        t.source,
        t.author,
        t.licenseUrl,
        t.sourcePage,
        t.downloadUrl,
        t.attribution,
        t.commercialUse === null ? null : t.commercialUse ? 1 : 0,
        rightsStatus,
        t.rightsCheckedAt,
        t.bpm,
        t.energy,
        t.instrumental === null ? null : t.instrumental ? 1 : 0,
        json(t.tags),
        trackProblems.join("；"),
        json(t.evidence ?? null),
        cur.asset_hash,
        sha,
        Date.now(),
        t.id,
      );
      if (rightsStatus === "verified") report.accepted++;
      else {
        report.pending++;
        report.missingLicense++;
      }
      report.tracks.push({ ...outcome, reasons: trackProblems });
      continue;
    }

    log(`处理曲目「${t.title}」…`);
    const m = await measureLoudness(src, { i: MUSIC_LUFS, tp: -2, lra: 11 });
    const out = await tempPath("m4a");
    await ffmpeg(["-i", src, "-vn", "-map_metadata", "-1", "-af", `${loudnormFilter(m, { i: MUSIC_LUFS, tp: -2, lra: 11 })},aresample=48000`, "-ac", "2", "-c:a", "aac", "-b:a", "192k", out]);
    const asset = await putFile(out, {
      ext: "m4a",
      mime: "audio/mp4",
      meta: {
        source: "music-library",
        trackId: t.id,
        license: t.license,
        licenseUrl: t.licenseUrl,
        sourcePage: t.sourcePage,
        author: t.author,
        rightsStatus,
        sha256: sha,
      },
    });

    const normalizedOwner = byNormalized.get(asset.hash);
    if (normalizedOwner) {
      const reason = `与曲目 ${normalizedOwner} 的规范化文件重复（sha256 ${asset.hash.slice(0, 12)}…）`;
      problems.push(`曲目「${t.title}」${reason}`);
      outcome.status = "duplicate";
      outcome.reasons = [reason];
      report.duplicate++;
      run("DELETE FROM music_tracks WHERE id = ?", t.id);
      report.tracks.push(outcome);
      continue;
    }
    byNormalized.set(asset.hash, t.id);

    upsertRow({ track: t, rightsStatus, reasons: trackProblems, sha256: sha, sig, assetHash: asset.hash, normalizedSha256: asset.hash, durationMs: asset.durationMs ?? info.durationMs ?? 0, loudness: m.i });
    if (rightsStatus === "verified") report.accepted++;
    else {
      report.pending++;
      report.missingLicense++;
    }
    report.tracks.push({ ...outcome, reasons: trackProblems });
  }

  for (const r of all<{ id: string }>("SELECT id FROM music_tracks")) if (!seen.has(r.id)) run("DELETE FROM music_tracks WHERE id = ?", r.id);
  return { count: seen.size, problems, report };
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
