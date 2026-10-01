import path from "path";
import { assessLicense, attributionFor, type ManifestTrack } from "./music-library";

/**
 * 批量导入的纯逻辑：URL 校验、robots 解析、路径安全、下载结果与音频质检判定、报告与 NOTICE 渲染。
 * 不做任何网络/文件 IO，便于单元测试。
 */

/** 默认允许下载和取证的官方来源域名（可用 --allow-domain 追加） */
export const DEFAULT_ALLOWED_DOMAINS = [
  "creativecommons.org",
  "openverse.org",
  "api.openverse.org",
  "wordpress.org",
  "commons.wikimedia.org",
  "upload.wikimedia.org",
  "wikimedia.org",
  "archive.org",
  "web.archive.org",
  "freemusicarchive.org",
  "files.freemusicarchive.org",
  "incompetech.com",
  "pixabay.com",
  "cdn.pixabay.com",
  "freesound.org",
  "cdn.freesound.org",
  "jamendo.com",
  "prod-1.storage.jamendo.com",
  "musopen.org",
  "cdn.musopen.org",
];

export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "flac"] as const;
export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];

export const DEFAULT_MAX_FILE_BYTES = 30 * 1024 * 1024;
export const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

export type UrlCheck = { ok: true; url: URL; host: string } | { ok: false; reason: string };

export function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return allowed.some((domain) => {
    const d = domain.toLowerCase().replace(/^www\./, "");
    return h === d || h.endsWith(`.${d}`);
  });
}

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (h.includes(":")) return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
  return false;
}

/**
 * 只允许 HTTPS、非内网、无凭据、且命中允许域名的 URL。
 * 这既防路径/SSRF，也保证「只访问明确允许的官方来源」。
 */
export function checkSourceUrl(raw: string, allowed: string[]): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `URL 不合法：${raw}` };
  }
  if (url.protocol !== "https:") return { ok: false, reason: `只允许 HTTPS：${raw}` };
  if (url.username || url.password) return { ok: false, reason: `URL 不允许携带凭据：${raw}` };
  if (isPrivateHost(url.hostname)) return { ok: false, reason: `不允许访问内网地址：${url.hostname}` };
  if (!hostAllowed(url.hostname, allowed)) return { ok: false, reason: `域名不在允许列表：${url.hostname}` };
  return { ok: true, url, host: url.hostname.toLowerCase().replace(/^www\./, "") };
}

export type RobotsRules = { allow: string[]; disallow: string[] };

/** 解析 robots.txt 中匹配指定 User-Agent（含 *）的规则 */
export function parseRobots(text: string, userAgent = "*"): RobotsRules {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: { agents: string[]; rules: { allow: boolean; path: string }[] } | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (key === "disallow" || key === "allow") {
      if (!current) {
        current = { agents: ["*"], rules: [] };
        groups.push(current);
      }
      current.rules.push({ allow: key === "allow", path: value });
    }
  }
  const ua = userAgent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const selected = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules: RobotsRules = { allow: [], disallow: [] };
  for (const group of selected) {
    for (const rule of group.rules) {
      if (rule.allow) rules.allow.push(rule.path);
      else rules.disallow.push(rule.path);
    }
  }
  return rules;
}

/** 标准最长匹配优先：空 Disallow 表示全部允许；匹配不到任何规则时允许 */
export function robotsAllows(rules: RobotsRules, targetPath: string): boolean {
  const pathname = targetPath || "/";
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of rules.disallow) {
    if (rule && pathname.startsWith(rule) && (!best || rule.length > best.length)) best = { allow: false, length: rule.length };
  }
  for (const rule of rules.allow) {
    if (rule && pathname.startsWith(rule) && (!best || rule.length >= best.length)) best = { allow: true, length: rule.length };
  }
  return best?.allow ?? true;
}

/** 把曲目 id 映射为安全的文件名，拒绝任何路径穿越 */
export function safeFileName(id: string, ext: string): string | null {
  const cleanExt = ext.toLowerCase().replace(/^\./, "");
  if (!(AUDIO_EXTENSIONS as readonly string[]).includes(cleanExt)) return null;
  const base = id.replace(/[^\w.-]/g, "-").replace(/\.+/g, "-");
  if (!base || base === "." || base === ".." || base.startsWith("-")) return null;
  const name = `${base}.${cleanExt}`;
  if (path.basename(name) !== name) return null;
  return name;
}

export function extensionFromUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const name = url.pathname.split("/").pop() ?? "";
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    return ext || null;
  } catch {
    return null;
  }
}

export function looksLikeHtml(contentType: string | null, head: Buffer | Uint8Array): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("text/html")) return true;
  const text = Buffer.from(head).toString("latin1").slice(0, 128).trim().toLowerCase();
  return text.startsWith("<!doctype html") || text.startsWith("<html");
}

export type CandidateDecision = { action: "download" | "reject" | "quarantine" | "duplicate"; reasons: string[] };

/** 下载前的许可证/来源判定；strict 只影响报告汇总，不在判定层放宽标准 */
export function classifyCandidate(t: ManifestTrack, knownShas: ReadonlySet<string> = new Set()): CandidateDecision {
  const reasons: string[] = [];
  if (t.sha256 && knownShas.has(t.sha256)) return { action: "duplicate", reasons: [`原始 sha256 已存在：${t.sha256.slice(0, 12)}…`] };
  if (!t.downloadUrl) reasons.push("缺少官方下载地址 downloadUrl");
  if (!t.sourcePage) reasons.push("缺少官方来源页 sourcePage");
  const verdict = assessLicense(t);
  reasons.push(...verdict.reasons);
  if (verdict.status === "rejected") return { action: "reject", reasons };
  if (verdict.status !== "verified" || t.commercialUse !== true) {
    if (t.commercialUse !== true) reasons.push("商业使用许可未显式确认");
    return { action: "quarantine", reasons };
  }
  if (!t.downloadUrl || !t.sourcePage) return { action: "quarantine", reasons };
  return { action: "download", reasons };
}

export type AudioQcSummary = {
  durationMs: number | null;
  sampleRate: number | null;
  channels: number | null;
  silenceRatio: number;
  peakDb: number | null;
  issues: string[];
};

export type QcLimits = { minDurationMs?: number; maxDurationMs?: number; maxSilenceRatio?: number; minSampleRate?: number };

export const DEFAULT_QC_LIMITS: Required<QcLimits> = {
  minDurationMs: 10_000,
  maxDurationMs: 30 * 60_000,
  maxSilenceRatio: 0.5,
  minSampleRate: 22_050,
};

/**
 * 音频质检阈值判定（不含授权判断）。
 * fatal = 必须隔离（损坏、超短、超长、静音、采样率异常）；warnings = 记录但仍可入库。
 * 峰值只作为提示：导入后会经 -20 LUFS / TP -2dB 重编码，热母带不会把削波带进成片。
 */
export function audioQcIssues(qc: AudioQcSummary, limits: QcLimits = {}): { fatal: string[]; warnings: string[] } {
  const l = { ...DEFAULT_QC_LIMITS, ...limits };
  const fatal = [...qc.issues];
  const warnings: string[] = [];
  if (qc.durationMs === null) fatal.push("无法读取时长");
  else if (qc.durationMs < l.minDurationMs) fatal.push(`时长过短（${Math.round(qc.durationMs / 1000)}s）`);
  else if (qc.durationMs > l.maxDurationMs) fatal.push(`时长过长（${Math.round(qc.durationMs / 1000)}s）`);
  if (qc.sampleRate !== null && qc.sampleRate < l.minSampleRate) fatal.push(`采样率过低（${qc.sampleRate}Hz）`);
  if (qc.channels !== null && qc.channels < 1) fatal.push("声道数异常");
  if (qc.silenceRatio > l.maxSilenceRatio) fatal.push(`静音比例过高（${Math.round(qc.silenceRatio * 100)}%）`);
  else if (qc.silenceRatio > l.maxSilenceRatio * 0.7) warnings.push(`静音比例偏高（${Math.round(qc.silenceRatio * 100)}%）`);
  if (qc.peakDb !== null && qc.peakDb >= -0.1) warnings.push(`峰值接近满刻度（${qc.peakDb.toFixed(2)}dBFS，导入时会统一到 -20 LUFS）`);
  return { fatal: [...new Set(fatal)], warnings: [...new Set(warnings)] };
}

export type DownloadAssessment = { ok: boolean; issues: string[]; warnings: string[] };

const AUDIO_CONTENT_TYPES = ["application/ogg", "application/opus", "application/x-ogg", "application/octet-stream", "binary/octet-stream"];

/** 下载完成后的校验：Content-Type、扩展名、magic、字节数、质检 */
export function assessDownload(input: {
  contentType: string | null;
  declaredExt: string | null;
  magic: { ext: string; mime: string } | null;
  bytes: number;
  qc: AudioQcSummary;
}): DownloadAssessment {
  const issues: string[] = [];
  const type = (input.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type && !type.startsWith("audio/") && !AUDIO_CONTENT_TYPES.includes(type)) {
    issues.push(`Content-Type 不是音频：${type}`);
  }
  if (!(input.declaredExt && (AUDIO_EXTENSIONS as readonly string[]).includes(input.declaredExt))) issues.push(`扩展名不在允许列表：${input.declaredExt ?? "（无）"}`);
  if (!input.magic) issues.push("文件头不是已知音频格式");
  else if (input.declaredExt && input.magic.ext !== input.declaredExt && !(input.declaredExt === "aac" && input.magic.ext === "m4a") && !(["oga", "opus"].includes(input.declaredExt) && input.magic.ext === "ogg")) {
    issues.push(`扩展名与文件头不一致（${input.declaredExt} vs ${input.magic.ext}）`);
  }
  if (!input.bytes) issues.push("文件为空");
  const qc = audioQcIssues(input.qc);
  issues.push(...qc.fatal);
  return { ok: issues.length === 0, issues, warnings: qc.warnings };
}

export type ImportTrackStatus = "accepted" | "rejected" | "quarantine" | "duplicate" | "skipped";
export type ImportTrackResult = {
  id: string;
  title: string;
  status: ImportTrackStatus;
  sourcePage: string;
  downloadUrl: string;
  sha256: string;
  reasons: string[];
};

export type ImportReport = {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  strict: boolean;
  accepted: number;
  rejected: number;
  quarantine: number;
  duplicate: number;
  skipped: number;
  missingLicense: number;
  invalidAudio: number;
  totalBytes: number;
  tracks: ImportTrackResult[];
  commands: string[];
};

export function emptyImportReport(dryRun: boolean, strict: boolean, commands: string[] = []): ImportReport {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: "",
    dryRun,
    strict,
    accepted: 0,
    rejected: 0,
    quarantine: 0,
    duplicate: 0,
    skipped: 0,
    missingLicense: 0,
    invalidAudio: 0,
    totalBytes: 0,
    tracks: [],
    commands,
  };
}

/** strict 模式下导致退出码非 0 的问题（缺授权、排除、隔离、重复）；resume 跳过不算失败 */
export function strictImportFailures(report: ImportReport): string[] {
  if (!report.strict) return [];
  return report.tracks
    .filter((t) => t.status === "rejected" || t.status === "quarantine" || t.status === "duplicate")
    .map((t) => `${t.title}（${t.id}）：${t.status} — ${t.reasons.join("；") || "无原因"}`);
}

export function renderImportReport(report: ImportReport): string {
  const lines: string[] = [];
  lines.push(`# 曲库导入报告`);
  lines.push("");
  lines.push(`- 开始：${report.startedAt}`);
  lines.push(`- 结束：${report.finishedAt}`);
  lines.push(`- 模式：${report.dryRun ? "dry-run" : "实际导入"}${report.strict ? " · strict" : ""}`);
  lines.push(`- accepted：${report.accepted}`);
  lines.push(`- rejected：${report.rejected}`);
  lines.push(`- quarantine：${report.quarantine}`);
  lines.push(`- duplicate：${report.duplicate}`);
  lines.push(`- skipped（resume）：${report.skipped}`);
  lines.push(`- missing license：${report.missingLicense}`);
  lines.push(`- invalid audio：${report.invalidAudio}`);
  lines.push(`- 下载总量：${(report.totalBytes / 1024 / 1024).toFixed(1)} MB`);
  lines.push("");
  lines.push(`| 曲目 | 状态 | 来源 | sha256 | 原因 |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const t of report.tracks) {
    lines.push(`| ${t.title} (${t.id}) | ${t.status} | ${t.sourcePage || t.downloadUrl || "—"} | ${t.sha256 ? t.sha256.slice(0, 12) + "…" : "—"} | ${t.reasons.join("；") || "—"} |`);
  }
  lines.push("");
  if (report.commands.length) {
    lines.push(`## 运行过的命令`);
    lines.push("");
    for (const c of report.commands) lines.push(`- \`${c}\``);
  }
  return lines.join("\n") + "\n";
}

/** 生成 NOTICE.md：仅已核实、且需要署名的曲目（有作者或许可证要求署名） */
export function renderNotice(tracks: ManifestTrack[]): string {
  const lines: string[] = [];
  lines.push(`# 背景音乐版权与署名 NOTICE`);
  lines.push("");
  lines.push(`本文件由 npm run library:fetch 根据 bgm/library.json 自动生成，请勿手工编辑。`);
  lines.push("");
  for (const t of tracks.filter((x) => x.rightsStatus === "verified").sort((a, b) => (a.author || a.title).localeCompare(b.author || b.title))) {
    const needsAttribution = !!(t.author || /by|attribution|署名/i.test(t.license));
    if (!needsAttribution) continue;
    lines.push(`## ${t.title}`);
    lines.push("");
    lines.push(`- 作者：${t.author || "未注明"}`);
    lines.push(`- 许可证：${t.license || "未注明"}`);
    if (t.licenseUrl) lines.push(`- 许可证链接：${t.licenseUrl}`);
    if (t.sourcePage) lines.push(`- 来源页：${t.sourcePage}`);
    if (t.downloadUrl) lines.push(`- 下载地址：${t.downloadUrl}`);
    lines.push(`- 署名文本：${attributionFor(t)}`);
    if (t.evidence?.fetchedAt) lines.push(`- 审核日期：${t.evidence.fetchedAt}`);
    lines.push("");
  }
  if (lines.length <= 4) lines.push("当前曲库无需额外署名的曲目。\n");
  return lines.join("\n");
}
