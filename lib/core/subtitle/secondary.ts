import type { Line } from "../types";
import {
  bilingualTarget,
  countCjk,
  countLatin,
  detectSourceLanguage,
  inferScriptLanguage,
  looksLikeSecondary,
  normalizeScriptLanguage,
  type ScriptLanguage,
} from "./language";

/**
 * 双语字幕翻译行（secondaryText）的生命周期工具 —— 从 AI-Video 字幕模块移植。
 *
 * 不变式：
 * - 翻译单位 = 显示单位（一整句口播），逐句哈希锁定主行与翻译对应；
 * - 译文新鲜状态唯一：非空 + 目标语言正确 + secondaryHash 等于当前主行哈希；
 * - 无哈希旧译文只算「待验证」，不冒充已验证译文，也不计入覆盖率。
 */

export interface SecondaryUnit {
  id: string;
  text: string;
}

const PUNCT_RE = /[\s\p{P}\p{S}]+/gu;

export function primaryHash(text: string): string {
  const normalized = (text || "").replace(PUNCT_RE, "");
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return `${normalized.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

/** 画面上实际显示的口播文本（当前项目一句 line 就是显示单位） */
export function secondaryDisplayText(line: Pick<Line, "text">): string {
  return line.text;
}

function sameSubtitleText(a: string, b: string): boolean {
  return (a || "").replace(PUNCT_RE, "").toLowerCase() === (b || "").replace(PUNCT_RE, "").toLowerCase();
}

export function resolveLineLanguage(
  line: Pick<Line, "text">,
  language?: ScriptLanguage | null,
): ScriptLanguage {
  if (language) return normalizeScriptLanguage(language);
  return inferScriptLanguage(secondaryDisplayText(line));
}

export type SecondaryStatus = "fresh" | "stale" | "unverified" | "missing" | "invalid";

/**
 * 译文状态五态，渲染 / 覆盖率 / 待翻译队列共用同一判定：
 * - missing：没有译文（或没有主文本）
 * - invalid：有译文但语言方向不对（或和主行一模一样）
 * - unverified：语言正确但没有哈希，属于无哈希旧数据，只显示不信任
 * - stale：有哈希但与当前主行不匹配
 * - fresh：非空 + 语言正确 + 哈希匹配，唯一可信状态
 */
export function secondaryStatus(
  line: Pick<Line, "text" | "secondaryText" | "secondaryHash">,
  language?: ScriptLanguage | null,
): SecondaryStatus {
  const translated = (line.secondaryText || "").trim();
  const primary = secondaryDisplayText(line);
  if (!translated || !primary.trim()) return "missing";
  if (sameSubtitleText(primary, translated)) return "invalid";
  const scriptLanguage = resolveLineLanguage(line, language);
  if (!looksLikeSecondary(translated, scriptLanguage)) return "invalid";
  const hash = (line.secondaryHash || "").trim();
  if (!hash) return "unverified";
  return hash === primaryHash(primary) ? "fresh" : "stale";
}

/** 严格新鲜：只有非空译文 + 目标语言正确 + secondaryHash 匹配当前主行才算 */
export function isSecondaryFresh(
  line: Pick<Line, "text" | "secondaryText" | "secondaryHash">,
  language?: ScriptLanguage | null,
): boolean {
  return secondaryStatus(line, language) === "fresh";
}

/** 渲染端判定：fresh 或 unverified 可画（unverified 由 UI 标记待验证） */
export function isSecondaryUsable(
  line: Pick<Line, "text" | "secondaryText" | "secondaryHash">,
  language?: ScriptLanguage | null,
): boolean {
  const status = secondaryStatus(line, language);
  return status === "fresh" || status === "unverified";
}

/** 需要进翻译队列：所有非 fresh 且有主文本的句子（无哈希旧译文也要重新译） */
export function pendingTranslateUnits(
  lines: Line[],
  language?: ScriptLanguage | null,
): SecondaryUnit[] {
  const units: SecondaryUnit[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.id)) continue;
    seen.add(line.id);
    const text = secondaryDisplayText(line);
    if (!text) continue;
    if (secondaryStatus(line, language) !== "fresh") units.push({ id: line.id, text });
  }
  return units;
}

export function secondaryCoverage(
  lines: Line[],
  language?: ScriptLanguage | null,
): { total: number; fresh: number; stale: number } {
  let total = 0;
  let fresh = 0;
  for (const line of lines) {
    if (!secondaryDisplayText(line)) continue;
    total++;
    if (isSecondaryFresh(line, language)) fresh++;
  }
  return { total, fresh, stale: total - fresh };
}

export function applySecondaryTranslation(lines: Line[], translations: Map<string, string>): Line[] {
  return lines.map((line) => {
    const translated = translations.get(line.id);
    if (!translated) return line;
    return { ...line, secondaryText: translated, secondaryHash: primaryHash(secondaryDisplayText(line)) };
  });
}

/** 翻译质量校验：方向正确、长度比例合理、不过长（与服务端同一套阈值） */
export function secondaryLooksPlausible(source: string, translated: string, from: ScriptLanguage): boolean {
  if (from === "zh") {
    const zhChars = countCjk(source) || source.replace(/\s/g, "").length;
    const enWords = translated.trim().split(/\s+/).filter(Boolean).length;
    const ratio = enWords / Math.max(1, zhChars);
    return ratio >= 0.2 && ratio <= 2.6;
  }
  const words = source.trim().split(/\s+/).filter(Boolean).length;
  const zhChars = countCjk(translated) || translated.replace(/\s/g, "").length;
  const ratio = zhChars / Math.max(1, words);
  return ratio >= 0.4 && ratio <= 3.0;
}

function secondaryTooLongForTarget(translated: string, to: ScriptLanguage): boolean {
  if (to === "en") return translated.length > 80;
  return countCjk(translated) > 40 || translated.length > 60;
}

export function secondaryTooLong(translated: string, from: ScriptLanguage): boolean {
  return secondaryTooLongForTarget(translated, bilingualTarget(from));
}

export function looksTranslated(translated: string, from: ScriptLanguage): boolean {
  if (from === "zh") return countLatin(translated) >= 3 && countCjk(translated) === 0;
  return countCjk(translated) >= 2;
}

/**
 * 统一质量门（纯函数，服务端与客户端共用）：
 * 目标语言正确 + 源文/译文长度比例合理 + 长度上限。任何重试都不得绕过。
 */
export function assessSecondaryQuality(
  source: string,
  translated: string,
  from: ScriptLanguage,
  to: ScriptLanguage,
): { ok: boolean; reason?: string } {
  const text = (translated || "").trim();
  if (!text) return { ok: false, reason: "译文为空" };
  if (!looksLikeSecondary(text, bilingualTarget(to))) return { ok: false, reason: "译文语言不符" };
  if (!secondaryLooksPlausible(source, text, from)) return { ok: false, reason: "长度比例异常" };
  if (secondaryTooLongForTarget(text, to)) return { ok: false, reason: "译文过长" };
  return { ok: true };
}

export const TRANSLATE_BATCH_SIZE = 24;

export type SecondaryTranslateMode = "auto" | "zh" | "en";

export interface SecondaryTranslateItem {
  id: string;
  text: string;
  primaryHash: string;
}

export interface SecondaryTranslateFailure {
  id: string;
  reason: string;
}

export interface SecondaryTranslateSkipped {
  id: string;
  reason: string;
}

export interface SecondaryTranslateProgress {
  done: number;
  total: number;
}

export interface SecondaryTranslateOptions {
  modelId: string;
  /** auto（默认）逐句识别方向；zh/en 强制所有句子按该方向翻译 */
  mode?: SecondaryTranslateMode;
  signal?: AbortSignal;
  onProgress?: (progress: SecondaryTranslateProgress) => void;
}

export interface SecondaryTranslateResult {
  results: SecondaryTranslateItem[];
  failed: SecondaryTranslateFailure[];
  skipped: SecondaryTranslateSkipped[];
  translated: number;
  aborted: boolean;
  error?: string;
  /** 兼容旧调用：把 results 合并回 lines */
  lines: Line[];
}

type TranslateResponse = {
  items?: unknown;
  failed?: { id?: unknown; reason?: unknown }[];
  error?: string;
};

function rejectBatch(units: SecondaryUnit[], reason: string) {
  return {
    accepted: [] as SecondaryTranslateItem[],
    failed: units.map((unit) => ({ id: unit.id, reason })),
    error: reason,
  };
}

/**
 * 单批请求：响应只含翻译字段，客户端合并前二次校验质量和源文哈希。
 * 任何方向不符 / 比例异常 / 超长 / 哈希不匹配的条目不接受。
 */
async function requestBatch(
  batch: SecondaryUnit[],
  opts: { modelId: string; from: ScriptLanguage; to: ScriptLanguage; signal?: AbortSignal },
): Promise<{ accepted: SecondaryTranslateItem[]; failed: SecondaryTranslateFailure[]; error?: string }> {
  let res: Response;
  try {
    res = await fetch("/api/subtitle/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: opts.modelId, from: opts.from, to: opts.to, units: batch }),
      signal: opts.signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    return rejectBatch(batch, "连不上应用服务，请确认服务已启动后重试");
  }
  const data = (await res.json().catch(() => ({}))) as TranslateResponse;
  if (!res.ok || !Array.isArray(data?.items)) {
    const reason = data?.error || `翻译服务返回异常（HTTP ${res.status}）`;
    return rejectBatch(batch, reason);
  }
  const ids = new Set(batch.map((unit) => unit.id));
  const returned = new Map<string, { text: string; primaryHash: string }>();
  for (const item of data.items) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; text?: unknown; primaryHash?: unknown };
    const id = typeof row.id === "string" ? row.id : "";
    if (!id || !ids.has(id) || returned.has(id)) continue;
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!text) continue;
    returned.set(id, { text, primaryHash: typeof row.primaryHash === "string" ? row.primaryHash : "" });
  }
  const serverFailed = new Map<string, string>();
  if (Array.isArray(data.failed)) {
    for (const row of data.failed) {
      if (!row || typeof row.id !== "string" || serverFailed.has(row.id)) continue;
      serverFailed.set(row.id, typeof row.reason === "string" && row.reason ? row.reason : "译文未通过质量校验");
    }
  }
  const accepted: SecondaryTranslateItem[] = [];
  const failed: SecondaryTranslateFailure[] = [];
  for (const unit of batch) {
    const translated = returned.get(unit.id);
    if (!translated) {
      failed.push({ id: unit.id, reason: serverFailed.get(unit.id) || "模型未返回该句翻译" });
      continue;
    }
    const quality = assessSecondaryQuality(unit.text, translated.text, opts.from, opts.to);
    if (!quality.ok) {
      failed.push({ id: unit.id, reason: quality.reason || "译文未通过质量校验" });
      continue;
    }
    if (translated.primaryHash !== primaryHash(unit.text)) {
      failed.push({ id: unit.id, reason: "译文与当前文稿不匹配" });
      continue;
    }
    accepted.push({ id: unit.id, text: translated.text, primaryHash: translated.primaryHash });
  }
  return { accepted, failed, error: accepted.length === 0 && failed.length > 0 ? failed[0].reason : undefined };
}

/**
 * 批量补齐翻译行：只提交非 fresh 的句子，按句识别方向、按方向分组分片。
 * 响应按行合并（只包含翻译字段），任何质量或哈希不过关的结果都计入 failed。
 * 取消时在批次边界停止并返回部分结果，不抛异常。
 */
export async function translateLinesSecondary(
  lines: Line[],
  opts: SecondaryTranslateOptions,
): Promise<SecondaryTranslateResult> {
  const mode = opts.mode ?? "auto";
  const forced: ScriptLanguage | null = mode === "zh" || mode === "en" ? mode : null;
  const pending = pendingTranslateUnits(lines, forced);
  const results: SecondaryTranslateItem[] = [];
  const failed: SecondaryTranslateFailure[] = [];
  const skipped: SecondaryTranslateSkipped[] = [];
  const merged = new Map<string, string>();

  interface DirectionGroup {
    from: ScriptLanguage;
    to: ScriptLanguage;
    units: SecondaryUnit[];
  }
  const groups = new Map<string, DirectionGroup>();
  for (const unit of pending) {
    const from = forced ?? detectSourceLanguage(unit.text);
    if (!from) {
      skipped.push({ id: unit.id, reason: "无法判断语言方向" });
      continue;
    }
    const to = bilingualTarget(from);
    const key = `${from}:${to}`;
    let group = groups.get(key);
    if (!group) {
      group = { from, to, units: [] };
      groups.set(key, group);
    }
    group.units.push(unit);
  }

  const total = Array.from(groups.values()).reduce((sum, group) => sum + group.units.length, 0);
  let done = 0;
  let aborted = opts.signal?.aborted === true;
  batchLoop: for (const group of groups.values()) {
    for (let i = 0; i < group.units.length; i += TRANSLATE_BATCH_SIZE) {
      if (opts.signal?.aborted) {
        aborted = true;
        break batchLoop;
      }
      const batch = group.units.slice(i, i + TRANSLATE_BATCH_SIZE);
      try {
        const outcome = await requestBatch(batch, { modelId: opts.modelId, from: group.from, to: group.to, signal: opts.signal });
        results.push(...outcome.accepted);
        failed.push(...outcome.failed);
        for (const item of outcome.accepted) merged.set(item.id, item.text);
      } catch (e) {
        if (opts.signal?.aborted) {
          aborted = true;
          break batchLoop;
        }
        const reason = e instanceof Error ? e.message : "翻译失败";
        failed.push(...batch.map((unit) => ({ id: unit.id, reason })));
      }
      done += batch.length;
      opts.onProgress?.({ done, total });
    }
  }

  const translated = results.length;
  const missed = failed.length + skipped.length;
  const error =
    total === 0
      ? skipped.length > 0
        ? `有 ${skipped.length} 句无法判断语言方向`
        : undefined
      : translated === 0
        ? aborted
          ? undefined
          : failed[0]?.reason || "模型没有返回可用翻译，请检查模型设置"
        : missed > 0
          ? `有 ${missed} 条未译出`
          : undefined;

  return { results, failed, skipped, translated, aborted, error, lines: applySecondaryTranslation(lines, merged) };
}
