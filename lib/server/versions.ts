import { randomUUID } from "crypto";
import { projectDocSchema, type ProjectDoc } from "../core/types";
import { all, get, json, parseJson, run, tx } from "./db";
import { getProject, RevisionConflict } from "./projects";

type Row = { id: string; project_id: string; revision: number; label: string; doc: string; created_at: number };

function insert(projectId: string, revision: number, label: string, doc: ProjectDoc) {
  const id = randomUUID();
  run("INSERT INTO project_versions (id, project_id, revision, label, doc, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, projectId, revision, label, json(doc), Date.now());
  run("DELETE FROM project_versions WHERE project_id = ? AND id NOT IN (SELECT id FROM project_versions WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50)", projectId, projectId);
  return id;
}

export function listVersions(projectId: string) {
  return all<Row>("SELECT * FROM project_versions WHERE project_id = ? ORDER BY created_at DESC, rowid DESC", projectId).map(({ id, revision, label, doc, created_at }) => ({
    id, revision, label, createdAt: created_at, segments: (parseJson(doc, {}) as ProjectDoc).segments?.length ?? 0,
    summary: (parseJson(doc, {}) as ProjectDoc).brief?.summary?.slice(0, 120) ?? "",
  }));
}

export function getVersion(projectId: string, versionId: string) {
  const row = get<Row>("SELECT * FROM project_versions WHERE project_id = ? AND id = ?", projectId, versionId);
  return row && { id: row.id, revision: row.revision, label: row.label, createdAt: row.created_at, doc: projectDocSchema.parse(parseJson(row.doc, {})) };
}

export function createVersion(projectId: string, revision: number, label: string) {
  return tx(() => {
    const current = getProject(projectId);
    if (!current) return undefined;
    if (current.revision !== revision) throw new RevisionConflict(current);
    return insert(projectId, current.revision, label, current.doc);
  });
}

export function restoreVersion(projectId: string, versionId: string, revision: number) {
  return tx(() => {
    const current = getProject(projectId);
    if (!current) return undefined;
    if (current.revision !== revision) throw new RevisionConflict(current);
    const version = getVersion(projectId, versionId);
    if (!version) return null;
    insert(projectId, current.revision, "恢复版本前", current.doc);
    run("UPDATE projects SET doc = ?, title = ?, revision = revision + 1, updated_at = ? WHERE id = ?", json(version.doc), version.doc.brief.title.trim(), Date.now(), projectId);
    return getProject(projectId);
  });
}
