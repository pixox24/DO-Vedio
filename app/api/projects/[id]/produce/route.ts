import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { aspects } from "@/lib/core/types";
import { cancelProjectJobs, projectJobs } from "@/lib/server/jobs";
import { getProject } from "@/lib/server/projects";
import { drive, getGoal, produce, setGoal } from "@/lib/pipeline/plan";

const goalSchema = z.object({
  until: z.enum(["preview", "render"]),
  aspects: z.array(z.enum(aspects)).min(1),
  quality: z.enum(["draft", "final"]),
});

/** 查看计划和自动推进状态 */
export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/produce">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const p = getProject(id);
    if (!p) return fail("项目不存在", 404);
    const url = new URL(req.url);
    const goal = getGoal(id);
    const g = goal?.goal ?? {
      until: (url.searchParams.get("until") as "preview" | "render") ?? (p.doc.settings.pauseAfterPreview ? "preview" : "render"),
      aspects: p.doc.settings.aspects,
      quality: (url.searchParams.get("quality") as "draft" | "final") ?? "final",
    };
    const r = produce(id, g, { dryRun: true });
    return Response.json({ ...r, goal: goal ?? null, jobs: projectJobs(id) });
  });
}

const body = z.object({
  action: z.enum(["start", "stop", "step"]),
  goal: goalSchema.optional(),
  confirmBudget: z.boolean().optional(),
});

/**
 * start：开始一键成片（自动推进到目标）
 * step：只提交当前能做的任务，不自动推进（例如只配音）
 * stop：停止自动推进并取消排队中的任务
 */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/produce">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getProject(id)) return fail("项目不存在", 404);
    const { action, goal, confirmBudget } = await parseBody(req, body);
    if (action === "stop") {
      setGoal(id, null);
      return Response.json({ canceled: cancelProjectJobs(id) });
    }
    if (!goal) return fail("缺少目标");
    const r = action === "start" ? drive(id, goal, confirmBudget) : produce(id, goal, { confirmBudget });
    return Response.json({ ...r, goal: getGoal(id) ?? null });
  });
}
