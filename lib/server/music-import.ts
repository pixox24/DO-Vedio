import { createHash, randomUUID } from "crypto";
import { createReadStream, createWriteStream, promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { z } from "zod";
import {
  assessLicense,
  licenseEvidenceSchema,
  manifestTrackSchema,
  musicManifestSchema,
  type LicenseEvidence,
  type ManifestTrack,
} from "../core/music-library";
import {
  DEFAULT_ALLOWED_DOMAINS,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
  assessDownload,
  checkSourceUrl,
  classifyCandidate,
  emptyImportReport,
  extensionFromUrl,
  looksLikeHtml,
  parseRobots,
  renderImportReport,
  renderNotice,
  robotsAllows,
  safeFileName,
  strictImportFailures,
  type AudioQcSummary,
  type ImportReport,
  type ImportTrackResult,
} from "../core/music-import";
import { inspectAudio, probe } from "./ffmpeg";
import { sniff } from "./media";
import { libraryDir, syncLibrary } from "./music";

/**
 * 批量导入：只从白名单 HTTPS 官方来源下载，遵守 robots 与限速，
 * 先落 staging、校验文件头/内容类型/ffprobe 质检，算 sha256 后入库。
 * 任何失败只影响单曲，写入报告并继续；状态文件支持中断后 --resume。
 */

const IMPORT_UA = "dovedio-music-import/1.0 (+internal library audit)";
const MAX_REDIRECTS = 5;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000];
const EVIDENCE_MAX_BYTES = 512 * 1024;

export type ImportOptions = {
  input: string;
  output?: string;
  limit?: number;
  dryRun?: boolean;
  strict?: boolean;
  resume?: boolean;
  /** 不下载、不校验候选，只把 .staging 状态里已接受的曲目合并入库并同步（用于中断后收尾） */
  finalizeOnly?: boolean;
  allowDomains?: string[];
  maxFileBytes?: number;
  maxTotalBytes?: number;
  minDelayMs?: number;
  timeoutMs?: number;
  normalize?: boolean;
  log?: (...args: unknown[]) => void;
};

const candidateSchema = z.object({
  _note: z.string().optional(),
  tracks: z.array(manifestTrackSchema.omit({ file: true }).extend({ file: z.string().optional() })),
});

export async function loadCandidates(file: string): Promise<ManifestTrack[]> {
  const raw = await fs.readFile(file, "utf8");
  const parsed = candidateSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`候选清单不合法：${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("；")}`);
  return parsed.data.tracks.map((t) => {
    const ext = extensionFromUrl(t.downloadUrl ?? "") ?? "mp3";
    return { ...t, file: t.file || safeFileName(t.id, ext) || `${t.id}.mp3` } as ManifestTrack;
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const today = () => new Date().toISOString().slice(0, 10);

class BlockedError extends Error {}

/** 遵守 robots：404/410 或返回 HTML 视为无限制，5xx/429 保守阻断；结果按 host 缓存 */
async function robotsAllowed(url: URL, timeoutMs: number, log: (...a: unknown[]) => void, cache: Map<string, { ok: boolean; reason: string }>) {
  const key = url.host.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;
  const robotsUrl = `${url.protocol}//${url.host}/robots.txt`;
  let verdict: { ok: boolean; reason: string };
  try {
    const res = await fetch(robotsUrl, { headers: { "user-agent": IMPORT_UA }, signal: AbortSignal.timeout(Math.min(timeoutMs, 15_000)) });
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (res.status >= 400 && res.status < 500 && res.status !== 429) verdict = { ok: true, reason: "" };
    else if (!res.ok) verdict = { ok: false, reason: `robots.txt 返回 ${res.status}` };
    else if (contentType.includes("text/html")) verdict = { ok: true, reason: "" };
    else {
      const text = (await res.text()).slice(0, 256 * 1024);
      const rules = parseRobots(text, "dovedio-music-import");
      verdict = robotsAllows(rules, url.pathname) ? { ok: true, reason: "" } : { ok: false, reason: `robots.txt 禁止访问 ${url.pathname}` };
    }
  } catch (e) {
    log(`robots.txt 获取失败：${url.host} ${(e as Error).message}`);
    verdict = { ok: false, reason: `无法确认 robots.txt：${(e as Error).message}` };
  }
  cache.set(key, verdict);
  return verdict;
}

type FetchResult = { file: string; contentType: string | null; bytes: number; finalUrl: string };

/** 手动处理重定向，每一步都重新校验白名单；限制单文件大小、限速并重试 */
async function downloadTo(
  url: string,
  dest: string,
  opts: { allowed: string[]; maxBytes: number; timeoutMs: number; rate: Map<string, number>; minDelayMs: number; log: (...a: unknown[]) => void },
): Promise<FetchResult> {
  if (opts.maxBytes <= 0) throw new BlockedError("已达到总下载量上限");
  let current = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const checked = checkSourceUrl(current, opts.allowed);
    if (!checked.ok) throw new BlockedError(checked.reason);
    const host = checked.host;
    const wait = opts.minDelayMs - (Date.now() - (opts.rate.get(host) ?? 0));
    if (wait > 0) await sleep(wait);
    opts.rate.set(host, Date.now());

    let response: Response | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        response = await fetch(current, { redirect: "manual", headers: { "user-agent": IMPORT_UA, accept: "audio/*,*/*;q=0.8" }, signal: AbortSignal.timeout(opts.timeoutMs) });
      } catch (e) {
        if (attempt + 1 >= MAX_ATTEMPTS) throw new Error(`下载失败：${(e as Error).message}`);
        await sleep(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt + 1 >= MAX_ATTEMPTS) throw new Error(`下载失败：HTTP ${response.status}`);
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
        opts.log(`HTTP ${response.status}，等待 ${Math.round(delay / 1000)}s 后重试（${attempt + 2}/${MAX_ATTEMPTS}）`);
        await sleep(delay);
        continue;
      }
      break;
    }
    if (!response) throw new Error("下载失败：没有响应");
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`重定向缺少 Location（HTTP ${response.status}）`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
    if (!response.body) throw new Error("下载失败：响应没有正文");

    await fs.mkdir(path.dirname(dest), { recursive: true });
    let bytes = 0;
    const node = Readable.fromWeb(response.body as import("stream/web").ReadableStream<Uint8Array>);
    node.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > opts.maxBytes) node.destroy(new Error(`文件超过单文件上限 ${Math.round(opts.maxBytes / 1024 / 1024)}MB`));
    });
    try {
      await pipeline(node, createWriteStream(dest));
    } catch (e) {
      await fs.rm(dest, { force: true });
      throw e;
    }
    return { file: dest, contentType: response.headers.get("content-type"), bytes, finalUrl: current };
  }
  throw new BlockedError(`重定向次数超过 ${MAX_REDIRECTS}`);
}

async function sha256(file: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

type ImportState = {
  version: 1;
  tracks: Record<string, { status: string; file: string; sha256: string; reasons: string[]; manifest?: ManifestTrack }>;
};

async function readState(file: string): Promise<ImportState> {
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (!raw) return { version: 1, tracks: {} };
  try {
    const parsed = JSON.parse(raw) as ImportState;
    if (parsed && parsed.version === 1 && parsed.tracks) return parsed;
  } catch {
    // 状态损坏时从零开始
  }
  return { version: 1, tracks: {} };
}

const writeJson = async (file: string, value: unknown) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
};

/** 保存许可证证据：优先清单内联文本，否则抓取许可证链接，再退回已有本地证据文件 */
async function saveEvidence(output: string, t: ManifestTrack, allowed: string[], timeoutMs: number, log: (...a: unknown[]) => void): Promise<{ evidence: LicenseEvidence | null; problems: string[] }> {
  const inline = licenseEvidenceSchema.parse(t.evidence ?? {});
  const problems: string[] = [];
  const evidenceDir = path.join(output, "evidence");
  const evidenceFile = path.join(evidenceDir, `${safeFileName(t.id, "txt") ?? `${t.id}.txt`}`);

  if (inline.text.trim()) {
    await fs.mkdir(evidenceDir, { recursive: true });
    await fs.writeFile(evidenceFile, inline.text);
    return { evidence: { ...inline, file: path.relative(output, evidenceFile), sha256: await sha256(evidenceFile), fetchedAt: inline.fetchedAt || today() }, problems };
  }
  if (inline.file) {
    const local = path.resolve(output, inline.file);
    if (local.startsWith(path.resolve(output) + path.sep)) {
      const exists = await fs.stat(local).catch(() => null);
      if (exists) return { evidence: { ...inline, sha256: inline.sha256 || (await sha256(local)), fetchedAt: inline.fetchedAt || today() }, problems };
    }
    problems.push(`证据文件不存在或越界：${inline.file}`);
  }
  const target = inline.url || t.licenseUrl || t.sourcePage;
  if (!target) {
    problems.push("没有可保存的许可证证据（缺少 licenseUrl / evidence）");
    return { evidence: null, problems };
  }
  const checked = checkSourceUrl(target, allowed);
  if (!checked.ok) {
    problems.push(`无法抓取许可证证据：${checked.reason}`);
    return { evidence: null, problems };
  }
  try {
    const res = await fetch(target, { headers: { "user-agent": IMPORT_UA }, signal: AbortSignal.timeout(Math.min(timeoutMs, 20_000)) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.text()).slice(0, EVIDENCE_MAX_BYTES);
    await fs.mkdir(evidenceDir, { recursive: true });
    await fs.writeFile(evidenceFile, text);
    log(`已保存许可证证据：${t.id}`);
    return { evidence: { url: target, fetchedAt: today(), text: "", file: path.relative(output, evidenceFile), sha256: await sha256(evidenceFile) }, problems };
  } catch (e) {
    problems.push(`无法抓取许可证证据：${(e as Error).message}`);
    return { evidence: null, problems };
  }
}

/** 把接受的曲目合并回 library.json 并重写 NOTICE.md */
async function mergeManifest(output: string, accepted: ManifestTrack[]) {
  const file = path.join(output, "library.json");
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  let note = "";
  let previous: ManifestTrack[] = [];
  if (raw) {
    try {
      const parsed = musicManifestSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        note = parsed.data._note ?? "";
        previous = parsed.data.tracks;
      }
    } catch {
      // 旧清单损坏时以新导入为准，报告已记录
    }
  }
  const byId = new Map(previous.map((t) => [t.id, t]));
  for (const t of accepted) byId.set(t.id, t);
  const tracks = [...byId.values()];
  await writeJson(file, { ...(note ? { _note: note } : {}), tracks });
  await fs.writeFile(path.join(output, "NOTICE.md"), renderNotice(tracks));
  return tracks;
}

async function quarantineFile(staging: string, file: string) {
  const dir = path.join(staging, "quarantine");
  await fs.mkdir(dir, { recursive: true });
  await fs.rename(file, path.join(dir, path.basename(file))).catch(() => fs.rm(file, { force: true }));
}

/**
 * 汇总所有已接受的曲目（含上一次中断前接受的）：优先使用状态里保存的完整清单，
 * 旧状态没有清单时从候选 + 已保存的证据文件 + ffprobe 重建，保证 resume 收尾不丢曲目。
 */
async function collectAccepted(output: string, candidates: ManifestTrack[], state: ImportState): Promise<ManifestTrack[]> {
  const out: ManifestTrack[] = [];
  for (const candidate of candidates) {
    const entry = state.tracks[candidate.id];
    if (!entry || entry.status !== "accepted") continue;
    const abs = path.join(output, entry.file);
    if (!(await fs.stat(abs).catch(() => null))) continue;
    if (entry.manifest) {
      out.push({ ...entry.manifest, file: entry.file, sha256: entry.sha256 || entry.manifest.sha256 });
      continue;
    }
    const info = await probe(abs).catch(() => null);
    const evidenceFile = path.join(output, "evidence", `${candidate.id}.txt`);
    const hasEvidence = await fs.stat(evidenceFile).catch(() => null);
    const evidence = hasEvidence
      ? { url: candidate.licenseUrl, fetchedAt: candidate.rightsCheckedAt || today(), text: "", file: path.relative(output, evidenceFile), sha256: await sha256(evidenceFile) }
      : candidate.evidence;
    out.push({
      ...candidate,
      file: entry.file,
      sha256: entry.sha256 || (await sha256(abs)),
      durationMs: info?.durationMs ?? candidate.durationMs,
      evidence,
      rightsStatus: "verified",
      rightsCheckedAt: candidate.rightsCheckedAt || today(),
      commercialUse: true,
    });
  }
  return out;
}

const INVALID_QC: AudioQcSummary = { durationMs: null, sampleRate: null, channels: null, silenceRatio: 0, peakDb: null, issues: ["ffprobe/ffmpeg 质检失败"] };

/** 执行批量导入；返回报告。dryRun 时不发任何网络请求，也不写文件。 */
export async function runImport(opts: ImportOptions): Promise<{ report: ImportReport; manifest: ManifestTrack[] }> {
  const log = opts.log ?? (() => {});
  const output = path.resolve(opts.output ?? libraryDir());
  const staging = path.join(output, ".staging");
  const downloads = path.join(staging, "downloads");
  const stateFile = path.join(staging, "import-state.json");
  const report = emptyImportReport(!!opts.dryRun, !!opts.strict);
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const minDelayMs = opts.minDelayMs ?? 1_500;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const allowed = [...DEFAULT_ALLOWED_DOMAINS, ...(opts.allowDomains ?? [])];
  const rate = new Map<string, number>();
  const robotsCache = new Map<string, { ok: boolean; reason: string }>();

  const candidates = await loadCandidates(path.resolve(opts.input));
  const existingShas = new Set<string>();
  const existing = await fs.readFile(path.join(output, "library.json"), "utf8").catch(() => null);
  if (existing) {
    try {
      const parsed = musicManifestSchema.safeParse(JSON.parse(existing));
      if (parsed.success) for (const t of parsed.data.tracks) if (t.sha256) existingShas.add(t.sha256);
    } catch {
      // 忽略：以导入结果为准
    }
  }

  const state = opts.resume || opts.finalizeOnly ? await readState(stateFile) : { version: 1 as const, tracks: {} };
  if (!opts.resume && !opts.finalizeOnly) await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(downloads, { recursive: true });

  const seenSha = new Set(existingShas);
  const tally: Record<ImportTrackResult["status"], keyof Pick<ImportReport, "accepted" | "rejected" | "quarantine" | "duplicate" | "skipped">> = {
    accepted: "accepted",
    rejected: "rejected",
    quarantine: "quarantine",
    duplicate: "duplicate",
    skipped: "skipped",
  };

  const candidatesToProcess = opts.limit ? candidates.slice(0, opts.limit) : candidates;
  for (const candidate of opts.finalizeOnly ? [] : candidatesToProcess) {
    const reasons: string[] = [];
    const record = (status: ImportTrackResult["status"], extra: Partial<ImportTrackResult> = {}) => {
      report.tracks.push({ id: candidate.id, title: candidate.title, status, sourcePage: candidate.sourcePage, downloadUrl: candidate.downloadUrl, sha256: candidate.sha256 || "", reasons, ...extra });
      report[tally[status]]++;
      state.tracks[candidate.id] = { status, file: candidate.file, sha256: extra.sha256 ?? candidate.sha256, reasons };
    };
    const finish = async (status: ImportTrackResult["status"], extra: Partial<ImportTrackResult> = {}) => {
      record(status, extra);
      if (!opts.dryRun) await writeJson(stateFile, state);
    };

    const prior = state.tracks[candidate.id];
    const priorFile = prior?.file ? path.join(output, prior.file) : "";
    if (opts.resume && prior?.status === "accepted" && priorFile && (await fs.stat(priorFile).catch(() => null))) {
      reasons.push("resume：此前已导入");
      record("skipped", { sha256: prior.sha256 });
      state.tracks[candidate.id] = prior;
      if (!opts.dryRun) await writeJson(stateFile, state);
      continue;
    }

    const decision = classifyCandidate(candidate, seenSha);
    if (decision.action !== "download") {
      reasons.push(...decision.reasons);
      if (decision.action === "duplicate") await finish("duplicate", { sha256: candidate.sha256 });
      else if (decision.action === "reject") await finish("rejected");
      else {
        if (decision.reasons.some((r) => /许可证|证据|商业/.test(r))) report.missingLicense++;
        await finish("quarantine");
      }
      continue;
    }

    if (opts.dryRun) {
      reasons.push("dry-run：仅校验，不下载");
      await finish("skipped");
      continue;
    }

    let staged: string | null = null;
    try {
      const checked = checkSourceUrl(candidate.downloadUrl, allowed);
      if (!checked.ok) throw new BlockedError(checked.reason);
      const robots = await robotsAllowed(checked.url, timeoutMs, log, robotsCache);
      if (!robots.ok) throw new BlockedError(robots.reason);
      const ext = extensionFromUrl(candidate.downloadUrl) ?? "mp3";
      const stagedName = safeFileName(candidate.id, ext);
      if (!stagedName) throw new BlockedError(`扩展名不合法：${ext}`);
      staged = path.join(downloads, stagedName);
      const fetched = await downloadTo(candidate.downloadUrl, staged, { allowed, maxBytes: Math.min(maxFileBytes, maxTotalBytes - report.totalBytes), timeoutMs, rate, minDelayMs, log });
      report.totalBytes += fetched.bytes;

      const head = await fs.open(staged, "r").then(async (fh) => {
        const buf = Buffer.alloc(16);
        await fh.read(buf, 0, 16, 0);
        await fh.close();
        return buf;
      });
      if (looksLikeHtml(fetched.contentType, head)) throw new BlockedError("下载内容是 HTML 页面，不是音频文件");
      const magic = sniff(head);
      const sha = await sha256(staged);
      if (seenSha.has(sha)) {
        reasons.push(`下载内容与已有曲目 sha256 重复：${sha.slice(0, 12)}…`);
        await quarantineFile(staging, staged);
        await finish("duplicate", { sha256: sha });
        continue;
      }

      let qc: AudioQcSummary;
      try {
        const inspection = await inspectAudio(staged);
        qc = { durationMs: inspection.durationMs, sampleRate: inspection.sampleRate, channels: inspection.channels, silenceRatio: inspection.silenceRatio, peakDb: inspection.peakDb, issues: inspection.issues };
      } catch (e) {
        qc = { ...INVALID_QC, issues: [`ffprobe/ffmpeg 质检失败：${(e as Error).message}`] };
      }
      const checkedExt = extensionFromUrl(fetched.finalUrl) ?? ext;
      const assessment = assessDownload({ contentType: fetched.contentType, declaredExt: checkedExt, magic, bytes: fetched.bytes, qc });
      if (!assessment.ok) {
        reasons.push(...assessment.issues);
        report.invalidAudio++;
        await quarantineFile(staging, staged);
        await finish("quarantine", { sha256: sha });
        continue;
      }
      if (assessment.warnings.length > 0) reasons.push(`质检提示：${assessment.warnings.join("；")}`);

      const { evidence, problems: evidenceProblems } = await saveEvidence(output, candidate, allowed, timeoutMs, log);
      if (!evidence) {
        reasons.push(...evidenceProblems);
        report.missingLicense++;
        await quarantineFile(staging, staged);
        await finish("quarantine", { sha256: sha });
        continue;
      }

      const verdict = assessLicense({ ...candidate, evidence });
      if (verdict.status !== "verified") {
        reasons.push(...verdict.reasons, "导入时复核未通过");
        report.missingLicense++;
        await quarantineFile(staging, staged);
        await finish("quarantine", { sha256: sha });
        continue;
      }

      const finalName = safeFileName(candidate.id, ext)!;
      const dest = path.join(output, finalName);
      await fs.mkdir(output, { recursive: true });
      await fs.rename(staged, dest);
      const accepted: ManifestTrack = { ...candidate, file: finalName, sha256: sha, durationMs: qc.durationMs ?? 0, evidence, rightsStatus: "verified", rightsCheckedAt: today(), commercialUse: true };
      seenSha.add(sha);
      reasons.push("已导入");
      record("accepted", { sha256: sha });
      state.tracks[candidate.id] = { ...state.tracks[candidate.id], manifest: accepted };
      if (!opts.dryRun) await writeJson(stateFile, state);
    } catch (e) {
      reasons.push(e instanceof BlockedError ? `已阻断：${e.message}` : (e as Error).message);
      if (staged) await quarantineFile(staging, staged);
      await finish("quarantine");
    }
  }

  if (opts.finalizeOnly) {
    for (const candidate of candidates) {
      const entry = state.tracks[candidate.id];
      if (!entry) continue;
      const status = (["accepted", "rejected", "quarantine", "duplicate", "skipped"].includes(entry.status) ? entry.status : "quarantine") as ImportTrackResult["status"];
      const reasonText = entry.reasons.join("；");
      report.tracks.push({ id: candidate.id, title: candidate.title, status, sourcePage: candidate.sourcePage, downloadUrl: candidate.downloadUrl, sha256: entry.sha256, reasons: entry.reasons });
      report[tally[status]]++;
      if (status === "quarantine" && /许可证|证据|商业/.test(reasonText)) report.missingLicense++;
      if (status === "quarantine" && /质检|文件头|Content-Type|时长|静音|解码/.test(reasonText)) report.invalidAudio++;
    }
  }

  report.finishedAt = new Date().toISOString();
  const allAccepted = opts.dryRun ? [] : await collectAccepted(output, candidates, state);
  const merged = opts.dryRun ? [] : await mergeManifest(output, allAccepted);
  report.commands = [`node --import tsx scripts/library-fetch.ts --input ${path.relative(process.cwd(), path.resolve(opts.input))}${opts.strict ? " --strict" : ""}${opts.resume ? " --resume" : ""}${opts.finalizeOnly ? " --finalize-only" : ""} --output ${path.relative(process.cwd(), output)}`];
  if (!opts.dryRun) {
    const reportsDir = path.join(output, "reports");
    const stamp = report.startedAt.replace(/[:.]/g, "-");
    await writeJson(path.join(reportsDir, `import-${stamp}.json`), report);
    await fs.mkdir(reportsDir, { recursive: true });
    await fs.writeFile(path.join(reportsDir, `import-${stamp}.md`), renderImportReport(report));
  }
  if (opts.normalize !== false && !opts.dryRun) {
    process.env.MUSIC_DIR = output;
    const sync = await syncLibrary(log);
    for (const problem of sync.problems) log(`[同步] ${problem}`);
    report.commands.push(`MUSIC_DIR=${output} npm run library:ingest:strict`);
  }
  return { report, manifest: merged };
}

export { strictImportFailures };
