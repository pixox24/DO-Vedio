import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { presetPayloadSchema } from "@/lib/core/preset";
import { createPreset, getDefaultPresetId, listPresets } from "@/lib/server/presets";

export async function GET() {
  return handle(async () => Response.json({ presets: listPresets(), defaultId: getDefaultPresetId() }));
}

const body = z.object({
  name: z.string().trim().min(1, "请填写预设名称"),
  description: z.string().optional(),
  payload: presetPayloadSchema,
});

/** 新建预设；名称去空格后不能为空，payload 必须是完整的设置快照 */
export async function POST(req: Request) {
  return handle(async () => {
    const { name, description, payload } = await parseBody(req, body);
    return Response.json({ preset: createPreset({ name, description, payload }) }, { status: 201 });
  });
}
