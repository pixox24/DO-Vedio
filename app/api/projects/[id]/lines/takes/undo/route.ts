import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { undoLastTake } from "@/lib/pipeline/tts-common";
import { getProject } from "@/lib/server/projects";

const body = z.object({ keys: z.array(z.string().min(1)).min(1).max(200) });

/**
 * 撤销上一次重录：把归档的旧配音写回缓存。
 * 每个 key 只允许回退一步，再点一次会返回 409。
 */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/lines/takes/undo">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getProject(id)) return fail("项目不存在", 404);
    const { keys } = await parseBody(req, body);
    const restored = undoLastTake(id, keys);
    if (!restored) return fail("没有可撤销的重录记录（可能已经撤销过）", 409);
    return Response.json({ restored });
  });
}
