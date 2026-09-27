import { fail, handle, parseBody } from "@/lib/api";
import { visualStyleInputSchema } from "@/lib/core/types";
import { deleteVisualStyle, updateVisualStyle } from "@/lib/visual-styles/store";

export async function PUT(req: Request, ctx: RouteContext<"/api/visual-styles/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const style = await updateVisualStyle(id, await parseBody(req, visualStyleInputSchema));
    return style ? Response.json(style) : fail("风格不存在或为内置风格", 404);
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/visual-styles/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return (await deleteVisualStyle(id)) ? Response.json({ ok: true }) : fail("风格不存在或为内置风格", 404);
  });
}
