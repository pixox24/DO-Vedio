import { randomUUID } from "crypto";
import { isTtsStage } from "../core/keys";
import { emptyDoc, projectDocSchema, type Project, type ProjectDoc, type ProjectDocInput, type ProjectPipelineStatus, type ProjectSummary } from "../core/types";
import { normalizeSettings } from "../core/output-spec";
import { all, get, json, parseJson, run, tx } from "./db";
import { cancelProjectJobs } from "./jobs";

type Row = { id: string; title: string; doc: string; revision: number; created_at: number; updated_at: number };

/** 读出的文档一律经过 schema 补默认值，旧文档能平滑升级 */
function parseDoc(raw: string): ProjectDoc {
  const r = projectDocSchema.safeParse(parseJson(raw, {}));
  return r.success ? { ...r.data, settings: normalizeSettings(r.data.settings) } : { ...emptyDoc(), ...(parseJson(raw, {}) as object) };
}

const toProject = (r: Row): Project => ({
  id: r.id,
  title: r.title,
  revision: r.revision,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  doc: parseDoc(r.doc),
});

const titleOf = (doc: ProjectDoc) => doc.brief.title.trim();

export function listProjects(): ProjectSummary[] {
  return all<Row>("SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC").map((r) => {
    const p = toProject(r);
    const latestRender = get<{ video_hash: string; duration_ms: number; created_at: number }>("SELECT video_hash, duration_ms, created_at FROM renders WHERE project_id = ? ORDER BY created_at DESC LIMIT 1", p.id);
    const activeJob = get<{ stage: string; updated_at: number }>("SELECT stage, updated_at FROM jobs WHERE project_id = ? AND status IN ('queued', 'running') ORDER BY updated_at DESC LIMIT 1", p.id);
    const failedJob = get<{ stage: string; updated_at: number }>("SELECT stage, updated_at FROM jobs WHERE project_id = ? AND status = 'failed' ORDER BY updated_at DESC LIMIT 1", p.id);
    const pipelineStatus = projectStatus(p, activeJob, failedJob, latestRender?.created_at);
    return {
      id: p.id,
      title: p.title,
      revision: p.revision,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      minutes: p.doc.brief.minutes,
      segments: p.doc.segments.filter((s) => s.text.trim()).length,
      pipelineStatus,
      coverHash: latestRender?.video_hash ?? null,
      lastRenderDurationMs: latestRender?.duration_ms ?? null,
      lastRenderCreatedAt: latestRender?.created_at ?? null,
    };
  });
}

function projectStatus(project: Project, activeJob?: { stage: string; updated_at: number }, failedJob?: { stage: string; updated_at: number }, latestRenderAt?: number): ProjectPipelineStatus {
  if (!project.doc.segments.some((segment) => segment.text.trim())) return "empty";
  const latestPipelineAt = Math.max(activeJob?.updated_at ?? 0, failedJob?.updated_at ?? 0);
  if (failedJob && failedJob.updated_at >= (activeJob?.updated_at ?? 0) && failedJob.updated_at >= (latestRenderAt ?? 0)) return "failed";
  if (activeJob && activeJob.updated_at >= (latestRenderAt ?? 0)) {
    if (activeJob.stage === "annotate") return "annotating";
    if (isTtsStage(activeJob.stage)) return "voicing";
    if (activeJob.stage === "storyboard") return "storyboard";
    if (activeJob.stage === "music") return "music";
    if (activeJob.stage === "render") return "rendering";
  }
  if (latestRenderAt != null && latestRenderAt >= latestPipelineAt) return "ready";
  return "script";
}

export function getProject(id: string): Project | undefined {
  const r = get<Row>("SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL", id);
  return r && toProject(r);
}

export function createProject(input?: ProjectDocInput): Project {
  const doc = input ? projectDocSchema.parse(input) : emptyDoc();
  const now = Date.now();
  const id = randomUUID();
  run("INSERT INTO projects (id, title, doc, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)", id, titleOf(doc), json(doc), now, now);
  return getProject(id)!;
}

export class RevisionConflict extends Error {
  constructor(public current: Project) {
    super("文档已在别处修改");
  }
}

/**
 * 保存整个文档。baseRevision 与当前不一致时抛 RevisionConflict；
 * 传 null 表示强制覆盖。
 */
export function saveProject(id: string, doc: ProjectDoc, baseRevision: number | null): Project | undefined {
  return tx(() => {
    const cur = getProject(id);
    if (!cur) return undefined;
    if (baseRevision !== null && cur.revision !== baseRevision) throw new RevisionConflict(cur);
    const clean = projectDocSchema.parse(doc);
    run("UPDATE projects SET doc = ?, title = ?, revision = revision + 1, updated_at = ? WHERE id = ?", json(clean), titleOf(clean), Date.now(), id);
    return getProject(id);
  });
}

/**
 * 以最新文档为基础做原子修改（Worker 写回结果用）。
 * fn 返回 null 表示放弃修改。
 */
export function mutateProject(id: string, fn: (doc: ProjectDoc, p: Project) => ProjectDoc | null): Project | undefined {
  return tx(() => {
    const cur = getProject(id);
    if (!cur) return undefined;
    const next = fn(structuredClone(cur.doc), cur);
    if (!next) return cur;
    const clean = projectDocSchema.parse(next);
    run("UPDATE projects SET doc = ?, title = ?, revision = revision + 1, updated_at = ? WHERE id = ?", json(clean), titleOf(clean), Date.now(), id);
    return getProject(id);
  });
}

/** 删除进回收站；同时取消未结束的任务，避免继续为已删项目付费生成素材 */
export function deleteProject(id: string) {
  return tx(() => {
    const changed = run("UPDATE projects SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL", Date.now(), id).changes > 0;
    if (changed) cancelProjectJobs(id);
    return changed;
  });
}

/** 从回收站恢复 */
export function restoreProject(id: string) {
  return run("UPDATE projects SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL", id).changes > 0;
}

export function duplicateProject(id: string) {
  const p = getProject(id);
  if (!p) return undefined;
  return createProject({ ...p.doc, brief: { ...p.doc.brief, title: `${p.doc.brief.title || "未命名"}（副本）` } });
}

/** 轻量读取：只取 revision，SSE 轮询用 */
export function projectRevision(id: string) {
  return get<{ revision: number }>("SELECT revision FROM projects WHERE id = ? AND deleted_at IS NULL", id)?.revision;
}
