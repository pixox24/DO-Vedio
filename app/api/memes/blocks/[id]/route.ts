import { fail, handle } from "@/lib/api";
import { unblock } from "@/lib/server/memes";

/** 取消屏蔽：以后刷新搜到它会重新收录 */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/memes/blocks/[id]">) {
  return handle(async () => (unblock((await ctx.params).id) ? Response.json({ ok: true }) : fail("屏蔽记录不存在", 404)));
}
