import { randomUUID } from "crypto";
import { all, get, json, parseJson, run, tx } from "../server/db";
import type { GenerationKind, GenerationStatus, MediaCostStatus, MediaRecoveryContext, MediaRecoveryPhase } from "./types";

export type GenerationRunInput = {
  projectId?: string | null;
  jobId?: string | null;
  providerId: string;
  modelId: string;
  kind: GenerationKind;
  inputHash: string;
  params?: Record<string, unknown>;
};

export type GenerationRunHandle = { id: string; startedAt: number };

export type GenerationRunResult = {
  status: Exclude<GenerationStatus, "running">;
  latencyMs?: number;
  costYuan?: number;
  outputAssets?: string[];
  error?: string;
  ledgerId?: number;
};

export function startGenerationRun(input: GenerationRunInput): string {
  const id = randomUUID();
  run(
    `INSERT INTO generation_runs (id, project_id, job_id, provider_id, model_id, kind, input_hash, params, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
    id, input.projectId ?? null, input.jobId ?? null, input.providerId, input.modelId, input.kind, input.inputHash, json(input.params ?? {}), Date.now(),
  );
  return id;
}

export function beginGenerationRun(input: GenerationRunInput): GenerationRunHandle {
  const startedAt = Date.now();
  return { id: startGenerationRun(input), startedAt };
}

export function finishGenerationRun(id: string, result: GenerationRunResult) {
  run("UPDATE generation_runs SET status = ?, latency_ms = ?, cost_yuan = ?, output_assets = ?, error = ?, finished_at = ?, ledger_id = ? WHERE id = ?", result.status, result.latencyMs ?? 0, result.costYuan ?? 0, json(result.outputAssets ?? []), result.error ?? null, Date.now(), result.ledgerId ?? null, id);
}

/** 给生成记录补充说明（如参考图未生效），合并进 params */
export function noteGenerationRun(id: string, note: Record<string, unknown>) {
  const row = all<{ params: string }>("SELECT params FROM generation_runs WHERE id = ?", id)[0];
  run("UPDATE generation_runs SET params = ? WHERE id = ?", json({ ...parseJson<Record<string, unknown>>(row?.params ?? "{}", {}), ...note }), id);
}

export function failGenerationRun(handle: GenerationRunHandle, error: unknown, canceled = false) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "未知错误";
  finishGenerationRun(handle.id, { status: canceled || (error instanceof Error && error.name === "AbortError") ? "canceled" : "failed", latencyMs: Date.now() - handle.startedAt, error: message });
}

export type GenerationRunRow = {
  id: string;
  project_id: string | null;
  job_id: string | null;
  provider_id: string;
  model_id: string;
  kind: GenerationKind;
  input_hash: string;
  params: string;
  status: GenerationStatus;
  latency_ms: number | null;
  cost_yuan: number;
  output_assets: string;
  ledger_id: number | null;
  error: string | null;
  created_at: number;
  finished_at: number | null;
};

export type MediaRecoveryParams = Record<string, unknown> & {
  attemptId: string;
  requestHash: string;
  candidateIndex: number;
  shotId?: string;
  submissionStarted?: boolean;
  taskId?: string;
  outputUrl?: string;
  phase: MediaRecoveryPhase;
  costStatus: MediaCostStatus;
  remoteTerminal?: boolean;
  submissionRejected?: boolean;
};
export type MediaRecoveryRun = Omit<GenerationRunRow, "params" | "output_assets"> & {
  params: MediaRecoveryParams;
  outputAssets: string[];
};
function mediaRecoveryRow(row: GenerationRunRow): MediaRecoveryRun {
  const { params, output_assets, ...rest } = row;
  return { ...rest, params: parseJson<MediaRecoveryParams>(params, {} as MediaRecoveryParams), outputAssets: parseJson<string[]>(output_assets, []) };
}

/** Job/goal 不参与身份：恢复总是指向原 attempt 和原 candidate。 */
export function findMediaRecoveryRun(input: Pick<MediaRecoveryContext, "projectId" | "attemptId" | "requestHash" | "candidateIndex">): MediaRecoveryRun | undefined {
  const row = get<GenerationRunRow>(`SELECT * FROM generation_runs WHERE project_id = ? AND provider_id = 'autodl' AND kind = 'video'
    AND input_hash = ? AND json_extract(params, '$.attemptId') = ? AND json_extract(params, '$.candidateIndex') = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  input.projectId, input.requestHash, input.attemptId, input.candidateIndex);
  return row && mediaRecoveryRow(row);
}

/** 给派发层查原尝试，不复制 provider 持久化查询。包括失败/取消记录。 */
export function findOriginalMediaAttempt(input: { projectId: string; shotId: string; requestHash: string }): MediaRecoveryRun | undefined {
  const row = get<GenerationRunRow>(`SELECT * FROM generation_runs WHERE project_id = ? AND provider_id = 'autodl' AND kind = 'video'
    AND input_hash = ? AND json_extract(params, '$.shotId') = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  input.projectId, input.requestHash, input.shotId);
  return row && mediaRecoveryRow(row);
}

/** BEGIN IMMEDIATE 下创建并标记提交，防止两个进程同时 POST 同一 candidate。 */
export function acquireMediaRecoveryRun(context: MediaRecoveryContext, params: MediaRecoveryParams, modelId: string): { run: MediaRecoveryRun; created: boolean } {
  return tx(() => {
    const existing = findMediaRecoveryRun(context);
    if (existing) return { run: existing, created: false };
    const unresolved = all<GenerationRunRow>(`SELECT * FROM generation_runs WHERE project_id = ? AND provider_id = 'autodl' AND kind = 'video' AND input_hash = ?
      AND json_extract(params, '$.candidateIndex') = ? AND json_extract(params, '$.shotId') IS ? ORDER BY created_at DESC, rowid DESC`,
    context.projectId, context.requestHash, context.candidateIndex, params.shotId ?? null).map(mediaRecoveryRow)
      .find((r) => r.params.submissionStarted && !r.params.submissionRejected && !r.params.remoteTerminal && r.params.phase !== "ready");
    if (unresolved && !context.allowNewAttempt) return { run: unresolved, created: false };
    const id = startGenerationRun({ projectId: context.projectId, jobId: context.jobId, providerId: "autodl", modelId, kind: "video", inputHash: context.requestHash, params });
    return { run: mediaRecoveryRow(get<GenerationRunRow>("SELECT * FROM generation_runs WHERE id = ?", id)!), created: true };
  });
}

export function listGenerationRuns(projectId: string, limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  return all<GenerationRunRow>("SELECT * FROM generation_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?", projectId, safeLimit).map((r) => ({
    id: r.id,
    projectId: r.project_id,
    jobId: r.job_id,
    providerId: r.provider_id,
    modelId: r.model_id,
    kind: r.kind,
    inputHash: r.input_hash,
    params: parseJson(r.params, {}),
    status: r.status,
    latencyMs: r.latency_ms,
    costYuan: r.cost_yuan,
    outputAssets: parseJson<string[]>(r.output_assets, []),
    ledgerId: r.ledger_id,
    error: r.error,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  }));
}
