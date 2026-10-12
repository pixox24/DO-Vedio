import { randomUUID } from "crypto";
import { all, get, json, run, tx } from "../db";
import { viralDraftSchema } from "../../viral/schemas";
import { createEmptyDraft, hasMeaningfulInput } from "../../viral/state";
import type { ViralAdoption, ViralDraft, ViralInput, ViralMode, ViralScriptVersion, ViralTask } from "../../viral/types";
import { ViralError } from "./errors";

type DraftRow = { id: string; revision: number; generation: number; body: string; created_at: number; updated_at: number };
type MappingRow = { id: string; draft_id: string; version_id: string; settings_key: string; project_id: string; body: string; created_at: number };
export type ViralAdoptionMapping = { draftId: string; settingsKey: string; adoption: ViralAdoption };

/** This read has no transaction wrapper, so handoff may read it inside its own atomic transaction. */
export function getDraft(id: string): ViralDraft | undefined {
  const row = get<DraftRow>("SELECT * FROM viral_drafts WHERE id = ?", id);
  return row ? viralDraftSchema.parse(JSON.parse(row.body)) : undefined;
}

export function requireDraft(id: string): ViralDraft {
  const draft = getDraft(id);
  if (!draft) throw new ViralError("not_found", "复创草稿不存在", 404);
  return draft;
}

export function listDrafts(limit = 20): ViralDraft[] {
  return all<DraftRow>("SELECT * FROM viral_drafts ORDER BY updated_at DESC, id LIMIT ?", Math.max(1, Math.min(50, limit)))
    .map((row) => viralDraftSchema.parse(JSON.parse(row.body)));
}

export function assertDraftRevision(draft: ViralDraft, expectedRevision: number) {
  if (draft.revision !== expectedRevision) throw new ViralError("conflict", "草稿已有更新，请读取最新版本后重试", 409, { currentRevision: draft.revision });
}

export function assertDraftEditable(draft: ViralDraft) {
  if (draft.task && ["queued", "running", "stopping"].includes(draft.task.status)) throw new ViralError("locked", "任务进行中，请先停止再修改或采用", 409, { currentRevision: draft.revision });
}

export function createDraft(input: ViralInput, mode: ViralMode = "quick"): ViralDraft {
  if (!hasMeaningfulInput(input)) throw new ViralError("validation", "先填写参考稿或自己的主题，再保存草稿", 400);
  const now = new Date().toISOString();
  const draft: ViralDraft = viralDraftSchema.parse({ ...createEmptyDraft(input, mode, randomUUID(), now), revision: 1 });
  tx(() => run("INSERT INTO viral_drafts (id, revision, generation, body, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)", draft.id, draft.revision, json(draft), Date.parse(now), Date.parse(now)));
  return draft;
}

/** Working partial versions may be checkpointed in place. Complete versions stay immutable. */
export function archiveVersionWithinTx(draftId: string, version: ViralScriptVersion) {
  const previous = get<{ draft_id: string; body: string }>("SELECT draft_id, body FROM viral_versions WHERE id = ?", version.id);
  if (previous) {
    const old = JSON.parse(previous.body) as ViralScriptVersion;
    if (previous.draft_id !== draftId || (old.complete && json(old) !== json(version))) throw new ViralError("conflict", "完整稿件版本不可原地覆盖", 409);
  }
  run("INSERT INTO viral_versions (id, draft_id, body, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body", version.id, draftId, json(version), Date.parse(version.createdAt));
}

/** No nested transaction. Caller must hold a BEGIN IMMEDIATE transaction. Revision fencing remains mandatory. */
export function putDraftWithinTx(draft: ViralDraft, expectedRevision = draft.revision): ViralDraft {
  const next = viralDraftSchema.parse({ ...draft, revision: expectedRevision + 1, updatedAt: new Date().toISOString() });
  const updated = run("UPDATE viral_drafts SET revision = ?, body = ?, updated_at = ? WHERE id = ? AND revision = ?", next.revision, json(next), Date.parse(next.updatedAt), next.id, expectedRevision);
  if (!updated.changes) {
    const actual = getDraft(next.id);
    if (!actual) throw new ViralError("not_found", "复创草稿不存在", 404);
    throw new ViralError("conflict", "草稿已有更新，请读取最新版本后重试", 409, { currentRevision: actual.revision });
  }
  for (const version of next.versions) archiveVersionWithinTx(next.id, version);
  for (const history of next.inputHistory) run("INSERT OR IGNORE INTO viral_snapshots (id, draft_id, body, created_at) VALUES (?, ?, ?, ?)", history.id, next.id, json(history.snapshot), Date.parse(history.savedAt));
  if (next.task) persistTaskWithinTx(next.id, next.task);
  return next;
}

export function mutateDraftTransaction(id: string, expectedRevision: number, mutate: (draft: ViralDraft) => void, allowLocked = false): ViralDraft {
  return tx(() => {
    const draft = requireDraft(id);
    assertDraftRevision(draft, expectedRevision);
    if (!allowLocked) assertDraftEditable(draft);
    mutate(draft);
    return putDraftWithinTx(draft, expectedRevision);
  });
}

export function persistTaskWithinTx(draftId: string, task: ViralTask) {
  // The initial snapshot is immutable; task-local progress may augment its selection/outline later.
  run("INSERT OR IGNORE INTO viral_snapshots (id, draft_id, body, created_at) VALUES (?, ?, ?, ?)", task.id, draftId, json(task.snapshot), Date.parse(task.createdAt));
  run(`INSERT INTO viral_tasks (id, draft_id, snapshot_id, generation, status, body, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, body = excluded.body, updated_at = excluded.updated_at`,
  task.id, draftId, task.id, task.generation, task.status, json(task), Date.parse(task.createdAt), Date.parse(task.updatedAt));
}

export function nextDraftGenerationWithinTx(id: string) {
  const row = get<{ generation: number }>("UPDATE viral_drafts SET generation = generation + 1 WHERE id = ? RETURNING generation", id);
  if (!row) throw new ViralError("not_found", "复创草稿不存在", 404);
  return row.generation;
}

export function recordArtifactWithinTx(taskId: string, stage: string, artifact: unknown) {
  run("INSERT INTO viral_artifacts (task_id, stage, body, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(task_id, stage) DO UPDATE SET body = excluded.body", taskId, stage, json(artifact), Date.now());
}

export function getTaskArtifact(taskId: string, stage: string): unknown {
  const row = get<{ body: string }>("SELECT body FROM viral_artifacts WHERE task_id = ? AND stage = ?", taskId, stage);
  return row ? JSON.parse(row.body) : undefined;
}

export function findAdoptionMapping(draftId: string, versionId: string, settingsKey: string): ViralAdoptionMapping | undefined {
  const row = get<MappingRow>("SELECT * FROM viral_adoptions WHERE draft_id = ? AND version_id = ? AND settings_key = ?", draftId, versionId, settingsKey);
  return row ? { draftId: row.draft_id, settingsKey: row.settings_key, adoption: JSON.parse(row.body) as ViralAdoption } : undefined;
}

export function writeAdoptionMappingWithinTx(draftId: string, settingsKey: string, adoption: ViralAdoption) {
  run("INSERT INTO viral_adoptions (id, draft_id, version_id, settings_key, project_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", adoption.id, draftId, adoption.versionId, settingsKey, adoption.projectId, json(adoption), Date.parse(adoption.createdAt));
}

export function sourceByProject(projectId: string): { draftId: string; adoption: ViralAdoption } | undefined {
  const row = get<MappingRow>("SELECT * FROM viral_adoptions WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1", projectId);
  return row ? { draftId: row.draft_id, adoption: JSON.parse(row.body) as ViralAdoption } : undefined;
}
