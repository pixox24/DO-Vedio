import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { presetPayloadSchema } from "@/lib/core/preset";
import { deletePreset, updatePreset } from "@/lib/server/presets";

const patchBody = z.object({
  name: z.string().trim().min(1, "请填写预设名称").optional(),
  description: z.string().optional(),
  payload: presetPayloadSchema.optional(),
});

/** 更新预设；改预设不回溯已应用它的项目 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/presets/[id]">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = await parseBody(req, patchBody);
    const preset = updatePreset(id, patch);
    return preset ? Response.json({ preset }) : fail("预设不存在", 404);
  });
}

/** 删除预设；若是当前默认预设，默认指针一并清空 */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/presets/[id]">) {
  return handle(async () => (deletePreset((await ctx.params).id) ? Response.json({ ok: true }) : fail("预设不存在", 404)));
}
