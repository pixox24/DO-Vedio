import { randomUUID } from "crypto";
import { stableStringify } from "../core/hash";
import type { TtsResult } from "../core/keys";
import { projectDocSchema, type VoiceSettings } from "../core/types";
import { lineTtsKeys } from "../pipeline/artifacts";
import { ttsPrice } from "../pipeline/pricing";
import { cacheMany } from "./cache";
import { all, get, json, parseJson, run, tx } from "./db";
import { cancelJob, latestJobByKey } from "./jobs";
import { enqueueTtsSteps, ttsJobKeyOf, ttsSteps } from "../pipeline/tts-jobs";
import { getProject } from "./projects";

type Row = { project_id: string; voice: string; previous_voice: string; status: "pending" | "applied" };
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);
const jobKey = (projectId: string, key: string) => `voice-change:${projectId}:${key}`;

function latestBatchId(projectId: string) {
  return get<{ batch_id: string | null }>(
    "SELECT json_extract(input, '$.batchId') AS batch_id FROM jobs WHERE project_id = ? AND key LIKE ? AND status IN ('queued', 'running') AND json_extract(input, '$.batchId') IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    projectId,
    `${jobKey(projectId, "%")}`,
  )?.batch_id ?? undefined;
}

function keysFor(projectId: string, voice: VoiceSettings) {
  const project = getProject(projectId);
  if (!project) throw new Error("项目不存在");
  return lineTtsKeys({ ...project.doc, settings: { ...project.doc.settings, voice } }, projectId);
}

export function quoteVoiceChange(projectId: string, voice: VoiceSettings) {
  const project = getProject(projectId);
  if (!project) throw new Error("项目不存在");
  const current = lineTtsKeys(project.doc, projectId);
  const target = keysFor(projectId, voice);
  const hits = cacheMany<TtsResult>([...current, ...target].map((item) => item.key));
  const existing = current.filter((item) => hits.has(item.key)).length;
  const affected = current.filter((item, index) => hits.has(item.key) && item.key !== target[index]?.key).length;
  const reusable = target.filter((item) => hits.has(item.key)).length;
  const generate = existing ? target.length - reusable : 0;
  const price = ttsPrice(voice.provider, voice.model);
  const steps = ttsSteps(project.doc, projectId, target.filter((item) => !hits.has(item.key)), { voice });
  const estimatedCostYuan = price.unit && price.unit !== "characters" ? null : steps.reduce((sum, step) => sum + step.cost, 0);
  return { total: target.length, existing, affected, reusable, generate, jobs: existing ? steps.length : 0, estimatedCostYuan, changed: !same(project.doc.settings.voice, voice) };
}

export function getVoiceChange(projectId: string) {
  const row = get<Row>("SELECT * FROM voice_changes WHERE project_id = ?", projectId);
  if (!row) return null;
  const voice = parseJson<VoiceSettings>(row.voice, {} as VoiceSettings);
  const previousVoice = parseJson<VoiceSettings>(row.previous_voice, {} as VoiceSettings);
  const keys = keysFor(projectId, row.status === "pending" ? voice : previousVoice);
  const hits = cacheMany<TtsResult>(keys.map((item) => item.key));
  const missing = keys.filter((item) => !hits.has(item.key));
  const failed = row.status === "pending" ? missing.filter((item) => latestJobByKey(jobKey(projectId, ttsJobKeyOf(item)))?.status === "failed").length : 0;
  // 撤回永远可行：旧音频缺失时由 revertVoiceChange 自动排队补齐，不再要求完整性
  return { status: row.status, voice, total: keys.length, ready: keys.length - missing.length, missing: missing.length, failed, revertible: row.status === "applied", batchId: row.status === "pending" ? latestBatchId(projectId) : undefined };
}

function commit(projectId: string, expected: VoiceSettings, voice: VoiceSettings) {
  const project = getProject(projectId);
  if (!project || !same(project.doc.settings.voice, expected)) return false;
  const doc = projectDocSchema.parse({ ...project.doc, settings: { ...project.doc.settings, voice } });
  run("UPDATE projects SET doc = ?, revision = revision + 1, updated_at = ? WHERE id = ?", json(doc), Date.now(), projectId);
  return true;
}

export function finalizeVoiceChange(projectId: string) {
  return tx(() => {
    const row = get<Row>("SELECT * FROM voice_changes WHERE project_id = ? AND status = 'pending'", projectId);
    if (!row) return false;
    const voice = parseJson<VoiceSettings>(row.voice, {} as VoiceSettings);
    const keys = keysFor(projectId, voice);
    const hits = cacheMany<TtsResult>(keys.map((item) => item.key));
    if (keys.some((item) => !hits.has(item.key))) return false;
    const previous = parseJson<VoiceSettings>(row.previous_voice, {} as VoiceSettings);
    if (!commit(projectId, previous, voice)) return false;
    // 撤回流程把 voice 和 previous_voice 都设为旧音色。补录完成后清掉
    // 这条临时 pending 记录，不能把“恢复旧音色”伪装成一次新的可撤回应用。
    if (same(voice, previous)) {
      run("DELETE FROM voice_changes WHERE project_id = ?", projectId);
      return true;
    }
    run("UPDATE voice_changes SET status = 'applied', updated_at = ? WHERE project_id = ?", Date.now(), projectId);
    return true;
  });
}

export function applyVoiceChange(projectId: string, voice: VoiceSettings) {
  const quote = quoteVoiceChange(projectId, voice);
  if (!quote.changed) throw new Error("配音设置没有变化");
  const project = getProject(projectId)!;
  tx(() => {
    const active = get<Row>("SELECT * FROM voice_changes WHERE project_id = ? AND status = 'pending'", projectId);
    if (active) throw new Error("已有配音设置正在应用，请先取消或等待完成");
    if (!same(getProject(projectId)?.doc.settings.voice, project.doc.settings.voice)) throw new Error("项目配音设置已变化，请刷新后重试");
    run("INSERT OR REPLACE INTO voice_changes (project_id, voice, previous_voice, status, updated_at) VALUES (?, ?, ?, 'pending', ?)", projectId, json(voice), json(project.doc.settings.voice), Date.now());
  });
  if (!quote.existing) {
    tx(() => {
      if (!commit(projectId, project.doc.settings.voice, voice)) throw new Error("项目配音设置已变化，请刷新后重试");
      run("UPDATE voice_changes SET status = 'applied', updated_at = ? WHERE project_id = ?", Date.now(), projectId);
    });
    return getVoiceChange(projectId);
  }
  if (!quote.generate) {
    finalizeVoiceChange(projectId);
    return getVoiceChange(projectId);
  }
  retryVoiceChange(projectId);
  return getVoiceChange(projectId);
}

export function retryVoiceChange(projectId: string) {
  const row = get<Row>("SELECT * FROM voice_changes WHERE project_id = ? AND status = 'pending'", projectId);
  if (!row) throw new Error("没有待应用的配音设置");
  const voice = parseJson<VoiceSettings>(row.voice, {} as VoiceSettings);
  const keys = keysFor(projectId, voice);
  const hits = cacheMany<TtsResult>(keys.map((item) => item.key));
  const project = getProject(projectId)!;
  enqueueTtsSteps(projectId, ttsSteps(project.doc, projectId, keys.filter((item) => !hits.has(item.key)), { voice, keyPrefix: jobKey(projectId, ""), batchId: randomUUID() }));
  finalizeVoiceChange(projectId);
  return getVoiceChange(projectId);
}

export function cancelVoiceChange(projectId: string) {
  tx(() => {
    const row = get<Row>("SELECT * FROM voice_changes WHERE project_id = ? AND status = 'pending'", projectId);
    if (!row) throw new Error("没有待应用的配音设置");
    for (const job of all<{ id: string }>("SELECT id FROM jobs WHERE project_id = ? AND key LIKE ? AND status IN ('queued', 'running')", projectId, `voice-change:${projectId}:%`)) cancelJob(job.id);
    run("DELETE FROM voice_changes WHERE project_id = ?", projectId);
  });
}

/**
 * 撤回本次音色应用：**永远成功**。
 *
 * 旧音频缺失时不再抛错——那会让用户撞上一个自己无法预判、也无法解决的失败。
 * 改为立即回退 settings.voice，并把缺失的旧 key 排进队列补齐，
 * 期间界面显示「正在恢复旧配音 x/y 句」，复用配音批次的进度与停止入口。
 */
export function revertVoiceChange(projectId: string) {
  const row = get<Row>("SELECT * FROM voice_changes WHERE project_id = ? AND status = 'applied'", projectId);
  if (!row) throw new Error("没有可撤回的配音设置");
  const previous = parseJson<VoiceSettings>(row.previous_voice, {} as VoiceSettings);
  const applied = parseJson<VoiceSettings>(row.voice, {} as VoiceSettings);
  const keys = keysFor(projectId, previous);
  const hits = cacheMany<TtsResult>(keys.map((item) => item.key));
  const missing = keys.filter((item) => !hits.has(item.key));
  const changed = tx(() => {
    const ok = commit(projectId, applied, previous);
    if (!ok) return false;
    run("UPDATE voice_changes SET status = 'pending', voice = ?, updated_at = ? WHERE project_id = ?", json(previous), Date.now(), projectId);
    return true;
  });
  if (!changed) throw new Error("项目配音设置已变化，无法撤回");
  if (missing.length) {
    // 旧音频不全：立刻回退设置，同时补齐缺失的旧配音（与换音色用同一套排队逻辑）
    const project = getProject(projectId)!;
    enqueueTtsSteps(projectId, ttsSteps(project.doc, projectId, missing, { voice: previous, keyPrefix: jobKey(projectId, ""), batchId: randomUUID() }));
    finalizeVoiceChange(projectId);
  } else {
    run("DELETE FROM voice_changes WHERE project_id = ?", projectId);
  }
  return true;
}
