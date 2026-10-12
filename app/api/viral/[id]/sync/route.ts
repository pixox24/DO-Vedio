import { viralSyncSchema } from "@/lib/viral/schemas";
import { ViralError, viralBody, viralHandle, viralSuccess } from "@/lib/server/viral/errors";
import { syncViralDraft, viralSyncImpact } from "@/lib/server/viral/handoff";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return viralHandle(async () => {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) throw new ViralError("validation", "请指定已关联的制作");
    return viralSuccess(viralSyncImpact((await context.params).id, projectId));
  });
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return viralHandle(async () => viralSuccess(syncViralDraft((await context.params).id, await viralBody(request, viralSyncSchema))));
}
