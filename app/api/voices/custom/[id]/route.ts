import { fail, handle } from "@/lib/api";
import { deleteCustomVoice } from "@/lib/server/custom-voices";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/voices/custom/[id]">) {
  return handle(async () => (deleteCustomVoice((await ctx.params).id) ? Response.json({ ok: true }) : fail("音色不存在", 404)));
}
