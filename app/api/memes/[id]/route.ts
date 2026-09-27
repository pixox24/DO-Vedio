import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { deleteMeme, updateMeme } from "@/lib/server/memes";

const body = z.object({
  risk: z.enum(["safe", "caution", "banned"]).optional(),
  heat: z.enum(["rising", "peak", "fading", "dead"]).optional(),
  say: z.string().max(40).refine((v) => !/[<>\x00-\x1f\x7f]/.test(v), "不能包含 HTML 或控制字符").optional(),
});

export async function PATCH(req: Request, ctx: RouteContext<"/api/memes/[id]">) {
  return handle(async () => {
    const patch = await parseBody(req, body);
    return updateMeme((await ctx.params).id, patch) ? Response.json({ ok: true }) : fail("梗不存在", 404);
  });
}

/** ?block=1：删除并不再收录（以后刷新搜到它的任何写法都跳过） */
export async function DELETE(req: Request, ctx: RouteContext<"/api/memes/[id]">) {
  return handle(async () => {
    const block = new URL(req.url).searchParams.get("block") === "1";
    return deleteMeme((await ctx.params).id, block) ? Response.json({ ok: true }) : fail("梗不存在", 404);
  });
}
