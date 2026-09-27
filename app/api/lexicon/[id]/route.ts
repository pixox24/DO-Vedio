import { fail, handle } from "@/lib/api";
import { deleteLexicon } from "@/lib/server/lexicon";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/lexicon/[id]">) {
  return handle(async () => (deleteLexicon((await ctx.params).id) ? Response.json({ ok: true }) : fail("词条不存在", 404)));
}
