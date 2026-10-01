import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { cancelProjectJobBatch } from "@/lib/server/jobs";
import { getProject } from "@/lib/server/projects";

const body = z.object({ batchId: z.string().uuid() });

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/shots/generate/cancel">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getProject(id)) return fail("项目不存在", 404);
    const { batchId } = await parseBody(req, body);
    const canceled = cancelProjectJobBatch(id, "shot-generate", batchId);
    return Response.json({ batchId, canceled });
  });
}
