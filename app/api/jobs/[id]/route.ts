import { getProject } from "@/lib/server/projects";
import { videoRenderProblems } from "@/lib/pipeline/video-generation";
import { timelineFor } from "@/lib/pipeline/artifacts";
import { outputSpecForRequest } from "@/lib/core/output-spec";
import type { RenderInput } from "@/lib/pipeline/stages/render";
import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { run } from "@/lib/server/db";
import { cancelJob, getJob, retryJob } from "@/lib/server/jobs";
import { getGoal } from "@/lib/pipeline/plan";

export async function GET(_req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  return handle(async () => {
    const j = getJob((await ctx.params).id);
    return j ? Response.json(j) : fail("任务不存在", 404);
  });
}

const body = z.object({ action: z.enum(["cancel", "retry"]) });

export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { action } = await parseBody(req, body);
    const existing = getJob(id);
    if (action === "retry" && existing?.stage === "render" && existing.projectId) {
      const project = getProject(existing.projectId);
      if (project) {
        const input = existing.input as RenderInput;
        const frame = outputSpecForRequest(project.doc.settings, input.outputSpecId, input.aspect);
        const problems = videoRenderProblems(project.doc, timelineFor(project.doc, project.id, frame.id), frame);
        if (problems.length) return fail(problems[0], 409);
      }
    }
    const ok = action === "cancel" ? cancelJob(id) : retryJob(id);
    // 重试后解除「一键成片」的暂停状态，任务成功后会继续自动推进
    const job = getJob(id);
    if (ok && action === "retry" && job?.projectId) {
      const goalId = typeof job.input === "object" && job.input !== null && "goalId" in job.input ? (job.input as { goalId?: unknown }).goalId : undefined;
      const currentGoal = getGoal(job.projectId);
      if (!goalId || !currentGoal?.goal.goalId || currentGoal.goal.goalId === goalId) {
        run("UPDATE project_goals SET blocked = NULL, updated_at = ? WHERE project_id = ?", Date.now(), job.projectId);
      }
    }
    return ok ? Response.json(getJob(id)) : fail(action === "cancel" ? "任务已结束，无法取消" : "只有失败或已取消的任务可以重试", 409);
  });
}
