import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { cancelCatchUp, startCatchUp } from "@/lib/pipeline/catch-up";
import { getProject } from "@/lib/server/projects";

const body = z.object({ action: z.enum(["start", "cancel"]) });

/** 字幕或配乐停稳后，补渲已经有成片的画幅。取消只收掉这一类任务。 */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/catch-up">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getProject(id)) return fail("项目不存在", 404);
    const { action } = await parseBody(req, body);
    if (action === "cancel") return Response.json({ action: "canceled", count: cancelCatchUp(id) });
    return Response.json(startCatchUp(id));
  });
}
