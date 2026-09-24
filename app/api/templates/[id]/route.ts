import { fail, handle, parseBody } from "@/lib/api";
import { deleteTemplate, updateTemplate } from "@/lib/templates/store";
import { templateInputSchema } from "@/lib/types";

export async function PUT(req: Request, ctx: RouteContext<"/api/templates/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const t = await updateTemplate(id, await parseBody(req, templateInputSchema));
    return t ? Response.json(t) : fail("模板不存在或为内置模板", 404);
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/templates/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return (await deleteTemplate(id)) ? Response.json({ ok: true }) : fail("模板不存在或为内置模板", 404);
  });
}
