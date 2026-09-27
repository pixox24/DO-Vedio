import { fail, handle } from "@/lib/api";
import { listGenerationRuns } from "@/lib/providers/runs";
import { getProject } from "@/lib/server/projects";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getProject(id)) return fail("项目不存在", 404);
    const limit = Number(new URL(req.url).searchParams.get("limit") ?? 100);
    return Response.json({ runs: listGenerationRuns(id, Number.isFinite(limit) ? limit : 100) });
  });
}
