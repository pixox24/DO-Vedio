import { fail, handle } from "@/lib/api";
import { aspects, type Aspect } from "@/lib/core/types";
import { timelineHash } from "@/lib/core/timeline";
import { syncLines } from "@/lib/pipeline/plan";
import { timelineFor } from "@/lib/pipeline/artifacts";
import { getProject } from "@/lib/server/projects";

/** 派生时间轴：预览播放器直接用它作 inputProps */
export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/timeline">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const p = getProject(id);
    if (!p) return fail("项目不存在", 404);
    const a = new URL(req.url).searchParams.get("aspect") as Aspect;
    const aspect = aspects.includes(a) ? a : "16:9";
    const t = timelineFor(syncLines(p.doc), id, aspect);
    return Response.json({ timeline: t, hash: timelineHash(t), revision: p.revision });
  });
}
