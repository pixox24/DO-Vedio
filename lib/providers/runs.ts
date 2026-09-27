import { randomUUID } from "crypto";
import { all, json, parseJson, run } from "../server/db";
import type { GenerationKind, GenerationStatus } from "./types";

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
