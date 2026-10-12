import { fail, handle } from "@/lib/api";
import { deleteMotionNote } from "@/lib/server/motion-notes";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/motions/notes/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return deleteMotionNote(id) ? Response.json({ ok: true }) : fail("这条参考不存在", 404);
  });
}
