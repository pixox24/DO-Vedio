import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { customProvider, customProviderApiKey, deleteCustomProvider, fetchRemoteModels, normalizeBaseUrl, syncCustomModels, updateCustomProvider } from "@/lib/providers/custom";
import { listProviderProfiles } from "@/lib/providers/registry";

const body = z.object({ apiKey: z.string().min(1).max(2000).optional(), baseUrl: z.string().trim().min(1).max(500).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ providerId: string }> }) {
  return handle(async () => {
    const { providerId } = await ctx.params;
    if (!providerId.startsWith("custom-")) return fail("自定义服务商不存在", 404);
    const id = providerId.slice("custom-".length);
    const current = customProvider(id);
    if (!current) return fail("自定义服务商不存在", 404);
    const input = await parseBody(req, body);
    const apiKey = input.apiKey?.trim() || customProviderApiKey(id);
    if (!apiKey) return fail("服务商 Key 不存在，请重新填写", 400);
    const baseUrl = normalizeBaseUrl(input.baseUrl || current.base_url);
    const models = await fetchRemoteModels({ interfaceType: current.interface_type, baseUrl, apiKey });
    updateCustomProvider(id, { baseUrl, apiKey: input.apiKey });
    syncCustomModels(id, models);
    return Response.json({ providerId, models: listProviderProfiles().filter((p) => p.providerId === providerId) });
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ providerId: string }> }) {
  return handle(async () => {
    const { providerId } = await ctx.params;
    if (!providerId.startsWith("custom-") || !deleteCustomProvider(providerId.slice("custom-".length))) return fail("自定义服务商不存在", 404);
    return Response.json({ ok: true });
  });
}
