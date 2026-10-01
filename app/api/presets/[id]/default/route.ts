import { fail, handle } from "@/lib/api";
import { getDefaultPresetId, getPreset, setDefaultPreset } from "@/lib/server/presets";

/** 设为默认预设：新建项目不传 presetId 时使用 */
export async function POST(_req: Request, ctx: RouteContext<"/api/presets/[id]/default">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getPreset(id)) return fail("预设不存在", 404);
    setDefaultPreset(id);
    return Response.json({ defaultId: id });
  });
}

/** 清除默认预设；该 id 不是当前默认时也返回成功，保证幂等，并回传当前实际默认 */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/presets/[id]/default">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (getDefaultPresetId() === id) setDefaultPreset(null);
    return Response.json({ defaultId: getDefaultPresetId() });
  });
}
