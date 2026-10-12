import { outputSpecsFor } from "../core/output-spec";
import { subtitleTranslateUnits } from "../core/subtitle/translate-plan";
import type { Aspect } from "../core/types";
import { all } from "../server/db";
import { cancelCatchUpJobs, cancelJob, enqueue, latestJobByKey } from "../server/jobs";
import { getProject } from "../server/projects";
import { getGoal, planPipeline } from "./plan";

export type CatchUpJob = { id: string; aspect: string };

export type CatchUpResult =
  | { action: "fresh" }
  | { action: "skipped"; reason: string }
  | { action: "started"; jobs: CatchUpJob[] }
  | { action: "running"; jobs: CatchUpJob[] }
  | { action: "canceled"; count: number };

function catchUpJobs(projectId: string) {
  return all<{ id: string; key: string; input: string }>(
    `SELECT id, key, input FROM jobs
     WHERE project_id = ? AND stage = 'render' AND status IN ('queued', 'running')
       AND json_extract(input, '$.catchUp') = 1`,
    projectId,
  );
}

/** 只取消后台追成片的任务。用户点的生成和别的面板任务留着。 */
export function cancelCatchUp(projectId: string): number {
  return cancelCatchUpJobs(projectId);
}

function jobAspect(input: unknown): string {
  return input && typeof input === "object" && typeof (input as { aspect?: unknown }).aspect === "string" ? (input as { aspect: string }).aspect : "";
}

/**
 * 已经有成片、而且这次只差渲染、不再花钱时，把过期画幅补渲一遍。
 * 不写入制作目标，所以不会把「停止」和整条制作计划占住。
 * 还没有成片、配音分镜也要重做、或双语还有句子没译完时，什么都不提交。
 */
export function startCatchUp(projectId: string): CatchUpResult {
  const project = getProject(projectId);
  if (!project) throw new Error("项目不存在");
  const goal = getGoal(projectId);
  if (goal?.goal.goalId && !goal.blocked) {
    const active = all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM jobs WHERE project_id = ? AND status IN ('queued', 'running') AND json_extract(input, '$.goalId') = ?",
      projectId,
      goal.goal.goalId,
    )[0]?.n ?? 0;
    if (active > 0) return { action: "skipped", reason: "制作进行中" };
  }

  const aspects = outputSpecsFor(project.doc.settings).map((spec) => spec.aspect);
  const pendingTranslations = project.doc.settings.subtitle.bilingual ? subtitleTranslateUnits(project.doc.lines) : [];
  if (pendingTranslations.length > 0) return { action: "skipped", reason: `还有 ${pendingTranslations.length} 句没有翻译` };
  const plan = planPipeline(projectId, project.doc, { until: "render", aspects, quality: "final" });
  if (plan.costYuan > 0 || plan.steps.some((step) => step.stage !== "render")) {
    return { action: "skipped", reason: plan.waiting[0] || "还有未完成的制作步骤" };
  }

  const finals = new Set(all<{ aspect: string }>("SELECT DISTINCT aspect FROM renders WHERE project_id = ? AND quality = 'final'", projectId).map((row) => row.aspect));
  if (finals.size === 0) return { action: "skipped", reason: "还没有成片" };

  const todo = plan.steps.filter((step) => {
    const aspect = jobAspect(step.input);
    return finals.has(aspect);
  });
  if (todo.length === 0) {
    const running = catchUpJobs(projectId).map((row) => ({ id: row.id, aspect: jobAspect(JSON.parse(row.input) as unknown) }));
    return running.length ? { action: "running", jobs: running } : { action: "fresh" };
  }

  const wanted = new Set(todo.map((step) => step.key));
  for (const row of catchUpJobs(projectId)) {
    if (!wanted.has(row.key)) cancelJob(row.id);
  }

  let created = false;
  const jobs: CatchUpJob[] = [];
  for (const step of todo) {
    const aspect = jobAspect(step.input) as Aspect;
    const existing = latestJobByKey(step.key, projectId);
    if (existing && (existing.status === "queued" || existing.status === "running")) {
      jobs.push({ id: existing.id, aspect });
      continue;
    }
    created = true;
    const input = { ...(step.input as Record<string, unknown>), catchUp: true };
    const job = enqueue({ projectId, stage: "render", key: step.key, target: step.target, input, priority: step.priority, maxAttempts: 1, costEstimate: 0 });
    jobs.push({ id: job.id, aspect });
  }
  return { action: created ? "started" : "running", jobs };
}
