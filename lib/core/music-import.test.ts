import { describe, expect, it } from "vitest";
import { manifestTrackSchema } from "./music-library";
import {
  assessDownload,
  audioQcIssues,
  checkSourceUrl,
  classifyCandidate,
  emptyImportReport,
  parseRobots,
  renderNotice,
  robotsAllows,
  safeFileName,
  strictImportFailures,
  type AudioQcSummary,
} from "./music-import";

const ALLOWED = ["example.com", "creativecommons.org"];

const candidate = (extra: Record<string, unknown> = {}) =>
  manifestTrackSchema.parse({
    id: "track-1",
    file: "track-1.mp3",
    title: "Track 1",
    moods: ["轻松"],
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sourcePage: "https://example.com/track-1",
    downloadUrl: "https://example.com/files/track-1.mp3",
    commercialUse: true,
    rightsStatus: "verified",
    evidence: { url: "https://creativecommons.org/licenses/by/4.0/", fetchedAt: "2026-10-01", text: "commercial use allowed" },
    ...extra,
  });

const qc = (extra: Partial<AudioQcSummary> = {}): AudioQcSummary => ({ durationMs: 120_000, sampleRate: 48_000, channels: 2, silenceRatio: 0.05, peakDb: -1.2, issues: [], ...extra });

describe("来源 URL 校验", () => {
  it("只允许白名单内的 HTTPS 公网地址", () => {
    expect(checkSourceUrl("https://example.com/a.mp3", ALLOWED).ok).toBe(true);
    expect(checkSourceUrl("https://cdn.example.com/a.mp3", ALLOWED).ok).toBe(true);
    expect(checkSourceUrl("http://example.com/a.mp3", ALLOWED).ok).toBe(false);
    expect(checkSourceUrl("https://evil.com/a.mp3", ALLOWED).ok).toBe(false);
    expect(checkSourceUrl("https://user:pass@example.com/a.mp3", ALLOWED).ok).toBe(false);
    expect(checkSourceUrl("https://127.0.0.1/a.mp3", ALLOWED).ok).toBe(false);
    expect(checkSourceUrl("https://192.168.1.10/a.mp3", ALLOWED).ok).toBe(false);
    expect(checkSourceUrl("不是 URL", ALLOWED).ok).toBe(false);
  });
});

describe("robots", () => {
  it("解析并遵守 Disallow / Allow，最长匹配优先", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/open\nDisallow:\n", "dovedio-music-import");
    expect(robotsAllows(rules, "/public/a.mp3")).toBe(true);
    expect(robotsAllows(rules, "/private/a.mp3")).toBe(false);
    expect(robotsAllows(rules, "/private/open/a.mp3")).toBe(true);
  });

  it("空 Disallow 表示全部允许", () => {
    const rules = parseRobots("User-agent: *\nDisallow:", "x");
    expect(robotsAllows(rules, "/anything")).toBe(true);
  });
});

describe("文件名安全", () => {
  it("拒绝路径穿越与非法扩展名", () => {
    expect(safeFileName("track-1", "mp3")).toBe("track-1.mp3");
    expect(safeFileName("../../etc/passwd", "mp3")).toBeNull();
    expect(safeFileName("a/b", "mp3")).toBe("a-b.mp3");
    expect(safeFileName("track", "exe")).toBeNull();
    expect(safeFileName("..", "mp3")).toBeNull();
  });
});

describe("下载前判定", () => {
  it("缺许可证时 quarantine，strict 下会失败", () => {
    const pending = candidate({ license: "待确认", licenseUrl: "", commercialUse: null, rightsStatus: "pending", evidence: undefined });
    const decision = classifyCandidate(pending);
    expect(decision.action).toBe("quarantine");
    const report = emptyImportReport(false, true);
    report.quarantine++;
    report.missingLicense++;
    report.tracks.push({ id: pending.id, title: pending.title, status: "quarantine", sourcePage: "", downloadUrl: "", sha256: "", reasons: decision.reasons });
    expect(strictImportFailures(report).length).toBeGreaterThan(0);
  });

  it("禁商用条款直接 reject", () => {
    const nc = candidate({ license: "CC BY-NC 4.0", rightsStatus: "verified" });
    expect(classifyCandidate(nc).action).toBe("reject");
  });

  it("完整证据的候选允许下载", () => {
    expect(classifyCandidate(candidate()).action).toBe("download");
  });

  it("已知 sha256 直接判重复", () => {
    const sha = "a".repeat(64);
    expect(classifyCandidate(candidate({ sha256: sha }), new Set([sha])).action).toBe("duplicate");
  });
});

describe("下载后校验", () => {
  it("非音频 Content-Type / 假扩展名 / 无 magic 被拒绝", () => {
    expect(assessDownload({ contentType: "text/html", declaredExt: "mp3", magic: null, bytes: 100, qc: qc() }).ok).toBe(false);
    expect(assessDownload({ contentType: "audio/mpeg", declaredExt: "exe", magic: { ext: "mp3", mime: "audio/mpeg" }, bytes: 100, qc: qc() }).ok).toBe(false);
    expect(assessDownload({ contentType: "audio/mpeg", declaredExt: "mp3", magic: null, bytes: 100, qc: qc() }).ok).toBe(false);
    expect(assessDownload({ contentType: "audio/mpeg", declaredExt: "mp3", magic: { ext: "mp3", mime: "audio/mpeg" }, bytes: 100, qc: qc() }).ok).toBe(true);
  });

  it("质检覆盖损坏、过短、静音为 fatal，峰值过高为 warning", () => {
    expect(audioQcIssues(qc({ issues: ["解码失败"] })).fatal).toContain("解码失败");
    expect(audioQcIssues(qc({ durationMs: 3000 })).fatal.join()).toContain("时长过短");
    expect(audioQcIssues(qc({ silenceRatio: 0.9 })).fatal.join()).toContain("静音");
    expect(audioQcIssues(qc({ peakDb: 0 })).warnings.join()).toContain("峰值");
    expect(audioQcIssues(qc({ peakDb: 0 })).fatal).toEqual([]);
  });
});

describe("NOTICE", () => {
  it("只包含已核实且需要署名的曲目", () => {
    const verified = candidate({ author: "Artist", attribution: "Artist - Track 1 (CC BY 4.0)" });
    const pending = manifestTrackSchema.parse({ ...candidate(), rightsStatus: "pending" });
    const notice = renderNotice([verified, pending]);
    expect(notice).toContain("Track 1");
    expect(notice).toContain("Artist - Track 1 (CC BY 4.0)");
    expect(notice).not.toContain('"Track 1" · Artist');
  });
});
