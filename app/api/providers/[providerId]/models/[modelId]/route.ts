import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { getProviderProfile, saveModelProfileOverride } from "@/lib/providers/registry";

const body = z.object({ enabled: z.boolean().optional(), kind: z.enum(["text", "image"]).optional(), price: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])).optional(), defaults: z.record(z.string(), z.unknown()).optional(), limits: z.record(z.string(), z.union([z.number(), z.string()])).optional() });

export async function GET(_req: Request, ctx: { params: Promise<{ providerId: string; modelId: string }> }) {
  return handle(async () => {
    const { providerId, modelId } = await ctx.params;
    const model = getProviderProfile(providerId, modelId);
    return model ? Response.json(model) : fail("模型不存在", 404);
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ providerId: string; modelId: string }> }) {
  return handle(async () => {
    const { providerId, modelId } = await ctx.params;
    if (!getProviderProfile(providerId, modelId)) return fail("模型不存在", 404);
    const input = await parseBody(req, body);
    if (input.kind && (!providerId.startsWith("custom-") || (input.kind === "image" && getProviderProfile(providerId, modelId)?.interfaceType !== "openai-compatible"))) return fail("仅 OpenAI 兼容的第三方模型支持图片分类", 400);
    return Response.json(saveModelProfileOverride({ providerId, modelId, ...input }));
  });
}
