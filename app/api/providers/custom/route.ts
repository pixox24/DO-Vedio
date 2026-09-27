import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { createCustomProvider, deleteCustomProvider, fetchRemoteModels, markCustomProviderError, normalizeBaseUrl, syncCustomModels } from "@/lib/providers/custom";
import { listProviderProfiles } from "@/lib/providers/registry";

const body = z.object({
  name: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().min(1).max(500),
  interfaceType: z.enum(["openai-compatible", "anthropic"]),
  apiKey: z.string().min(1).max(2000),
});

export async function POST(req: Request) {
  return handle(async () => {
    const input = await parseBody(req, body);
    normalizeBaseUrl(input.baseUrl);
    const id = createCustomProvider(input);
    try {
      const models = await fetchRemoteModels(input);
      syncCustomModels(id, models);
      return Response.json({ providerId: `custom-${id}`, models: listProviderProfiles().filter((p) => p.providerId === `custom-${id}`) }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "拉取模型失败";
      markCustomProviderError(id, message);
      deleteCustomProvider(id);
      return fail(message, 400);
    }
  });
}
