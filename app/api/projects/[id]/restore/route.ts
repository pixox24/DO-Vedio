import { fail, handle } from "@/lib/api";
import { restoreProject } from "@/lib/server/projects";

/** 从回收站恢复项目 */
export async function POST(_req: Request, ctx: RouteContext<"/api/projects/[id]/restore">) {
  return handle(async () => (restoreProject((await ctx.params).id) ? Response.json({ ok: true }) : fail("回收站中没有该项目", 404)));
}
