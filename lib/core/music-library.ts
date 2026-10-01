import { z } from "zod";
import { moods } from "./types";

/**
 * 曲库清单 schema 与授权判定 —— 纯逻辑，无 IO。
 *
 * library.json 的旧字段（id/file/title/moods/loopable/license/source/gainDb）保持兼容：
 * 缺少新字段时按保守默认值补全，rightsStatus 默认 pending，绝不猜测授权。
 */

export const rightsStatuses = ["pending", "verified", "rejected", "quarantine"] as const;
export type RightsStatus = (typeof rightsStatuses)[number];

export const rightsStatusLabels: Record<RightsStatus, string> = {
  pending: "待核实",
  verified: "已核实",
  rejected: "已排除",
  quarantine: "隔离",
};

export const musicEnergies = ["low", "medium", "high"] as const;
export type MusicEnergy = (typeof musicEnergies)[number];

export const energyLabels: Record<MusicEnergy, string> = { low: "低", medium: "中", high: "高" };

/** 许可证证据：页面原文摘录或保存的本地证据文件；两者至少有其一才算「可保存的证据」 */
export const licenseEvidenceSchema = z.object({
  /** 证据来源 URL（官方许可证页或来源页快照） */
  url: z.string().default(""),
  /** 获取日期 YYYY-MM-DD */
  fetchedAt: z.string().default(""),
  /** 许可证关键原文摘录 */
  text: z.string().default(""),
  /** 本地证据文件（相对 bgm/ 的路径） */
  file: z.string().default(""),
  /** 证据文件内容的 sha256 */
  sha256: z.string().default(""),
});
export type LicenseEvidence = z.infer<typeof licenseEvidenceSchema>;

export const manifestTrackSchema = z.object({
  id: z.string().regex(/^[\w-]+$/, "曲目 id 只能用字母、数字、横线"),
  file: z.string().min(1),
  title: z.string().min(1),
  moods: z.array(z.enum(moods)).min(1),
  loopable: z.boolean().default(true),
  license: z.string().default(""),
  source: z.string().default(""),
  gainDb: z.number().optional(),
  /** 作者 / 表演者 */
  author: z.string().default(""),
  /** 官方许可证链接（CC 等） */
  licenseUrl: z.string().default(""),
  /** 官方来源页（曲目详情页） */
  sourcePage: z.string().default(""),
  /** 官方下载地址 */
  downloadUrl: z.string().default(""),
  /** 需要署名时的完整署名文本 */
  attribution: z.string().default(""),
  /** 是否明确允许商业使用；null = 未确认 */
  commercialUse: z.boolean().nullable().default(null),
  rightsStatus: z.enum(rightsStatuses).default("pending"),
  /** 授权核实日期 YYYY-MM-DD */
  rightsCheckedAt: z.string().default(""),
  /** 原始文件 sha256 */
  sha256: z.string().default(""),
  durationMs: z.number().int().nonnegative().default(0),
  bpm: z.number().positive().nullable().default(null),
  energy: z.enum(musicEnergies).nullable().default(null),
  /** 是否纯器乐；null = 未知 */
  instrumental: z.boolean().nullable().default(null),
  tags: z.array(z.string()).default([]),
  /** 被禁用时的原因（非空即不参与选曲） */
  disabledReason: z.string().default(""),
  evidence: licenseEvidenceSchema.optional(),
  /** 旧清单里出现的备注字段 */
  note: z.string().default(""),
});
export type ManifestTrack = z.infer<typeof manifestTrackSchema>;

export const musicManifestSchema = z.object({
  _note: z.string().optional(),
  tracks: z.array(manifestTrackSchema),
});
export type MusicManifest = z.infer<typeof musicManifestSchema>;

export const isUsableTrack = (t: Pick<ManifestTrack, "rightsStatus" | "disabledReason">) => t.rightsStatus === "verified" && !t.disabledReason;

/** 条款明确禁止商用 / 改编的许可证特征（先于允许列表判断） */
const blockedLicensePatterns: RegExp[] = [
  /non-?commercial/i,
  /非商业/,
  /\bNC\b/,
  /no-?derivat/i,
  /禁止改编|不得改编/,
  /\bND\b/,
  /all rights reserved/i,
  /保留所有权利/,
  /personal use only/i,
  /个人使用|仅供个人/,
  /education(al)? use only/i,
];

/** 明确允许商业使用、视频同步和改编的许可证特征 */
const allowedLicensePatterns: RegExp[] = [
  /cc0/i,
  /public domain|公有领域|cc[- ]?pdm|no known copyright/i,
  /creative commons attribution|cc[ -]?by(?:[ -]?sa)?(?:[ -]?(?:[1-4](?:\.0)?))?/i,
  /pixabay content license/i,
  /free music archive.*(?:cc|creative commons)/i,
];

const hasEvidence = (t: Pick<ManifestTrack, "licenseUrl" | "evidence">) =>
  !!(t.licenseUrl?.trim() || t.evidence?.text?.trim() || t.evidence?.file?.trim());

export type LicenseVerdict = {
  status: RightsStatus;
  commercialUse: boolean | null;
  reasons: string[];
};

/**
 * 授权判定：不猜测。没有许可证原文、官方许可证链接或可保存的证据时一律 pending。
 * 显式 verified 但证据不足或条款禁商用/禁改编时降级，显式 rejected/quarantine 保持原状。
 */
export function assessLicense(t: Pick<ManifestTrack, "license" | "licenseUrl" | "commercialUse" | "rightsStatus" | "disabledReason" | "evidence">): LicenseVerdict {
  const reasons: string[] = [];
  if (t.rightsStatus === "rejected") return { status: "rejected", commercialUse: false, reasons: ["清单中已标记为 rejected"] };
  if (t.rightsStatus === "quarantine") return { status: "quarantine", commercialUse: t.commercialUse, reasons: ["清单中已标记为 quarantine"] };

  const license = (t.license ?? "").trim();
  const blocked = blockedLicensePatterns.some((p) => p.test(license));
  if (blocked) return { status: "rejected", commercialUse: false, reasons: [`许可证疑似禁止商业使用或改编：${license || "（空）"}`] };
  if ((license.startsWith("待确认") || license === "")) {
    if (t.rightsStatus === "verified") reasons.push("缺少许可证名称，无法核实授权");
    return { status: "pending", commercialUse: t.commercialUse, reasons: [...reasons, "许可证未填写或仍为待确认"] };
  }
  if (!hasEvidence(t)) {
    if (t.rightsStatus === "verified") reasons.push("缺少许可证链接或证据，不能标记为已核实");
    return { status: "pending", commercialUse: t.commercialUse, reasons: [...reasons, "缺少可保存的许可证证据"] };
  }
  const allowed = allowedLicensePatterns.some((p) => p.test(license) || p.test(t.licenseUrl ?? ""));
  if (!allowed) {
    reasons.push(`许可证条款无法归类：${license}`);
    return { status: "pending", commercialUse: t.commercialUse, reasons };
  }
  if (t.commercialUse === false) {
    reasons.push("清单声明不允许商业使用");
    return { status: "rejected", commercialUse: false, reasons };
  }
  if (t.commercialUse === null && t.rightsStatus === "verified") {
    reasons.push("商业使用许可未显式确认");
    return { status: "pending", commercialUse: null, reasons };
  }
  return { status: t.rightsStatus === "verified" ? "verified" : "pending", commercialUse: t.commercialUse, reasons };
}

/** 清单条目的可读问题（导入报告用） */
export function manifestTrackProblems(t: ManifestTrack): string[] {
  const problems: string[] = [];
  const verdict = assessLicense(t);
  if (verdict.status !== "verified") problems.push(...verdict.reasons);
  if (t.rightsStatus === "verified" && verdict.status !== "verified") problems.push("清单声称已核实，但证据不足，已降级为待核实");
  return problems;
}

/** 生成署名文本：优先使用清单里的 attribution，否则按作者 + 标题 + 许可证组合 */
export function attributionFor(t: Pick<ManifestTrack, "title" | "author" | "license" | "licenseUrl" | "attribution" | "sourcePage">) {
  if (t.attribution.trim()) return t.attribution.trim();
  const parts = [`"${t.title}"`];
  if (t.author.trim()) parts.push(`作者 ${t.author.trim()}`);
  if (t.license.trim()) parts.push(t.license.trim());
  if (t.licenseUrl.trim()) parts.push(t.licenseUrl.trim());
  else if (t.sourcePage.trim()) parts.push(t.sourcePage.trim());
  return parts.join(" · ");
}
