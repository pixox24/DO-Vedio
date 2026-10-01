import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { cancelProjectJobBatch } from "@/lib/server/jobs";
import { getProject } from "@/lib/server/projects";

const body = z.object({ batchId: z.string().uuid() });

/**
 * 停止本次批量配音。只取消这一批次提交的任务，单独重录的任务不受影响。
 * 服务商已经接单的请求仍可能计费；已完成（写进缓存）的音频保留。
 */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/lines/tts/cancel">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getProject(id)) return fail("项目不存在", 404);
    const { batchId } = await parseBody(req, body);
    const canceled = cancelProjectJobBatch(id, ["tts", "tts-block"], batchId);
    return Response.json({ batchId, canceled });
  });
}
