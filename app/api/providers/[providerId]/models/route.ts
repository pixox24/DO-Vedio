import { handle, fail } from "@/lib/api";
import { listProviderProfiles } from "@/lib/providers/registry";

export async function GET(_req: Request, ctx: { params: Promise<{ providerId: string }> }) {
  return handle(async () => {
    const { providerId } = await ctx.params;
    const providers = listProviderProfiles().filter((p) => p.providerId === providerId);
    return providers.length ? Response.json({ models: providers }) : fail("供应商不存在", 404);
  });
}
