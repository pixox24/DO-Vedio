import { viralPatchSchema } from "@/lib/viral/schemas";
import { updateDraft } from "@/lib/server/viral/drafts";
import { viralBody, viralHandle, viralSuccess } from "@/lib/server/viral/errors";
import { refreshDraftTask } from "@/lib/server/viral/tasks";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return viralHandle(async () => viralSuccess(refreshDraftTask((await context.params).id)));
}

export async function PATCH(request: Request, context: Context) {
  return viralHandle(async () => {
    const patch = await viralBody(request, viralPatchSchema);
    return viralSuccess(updateDraft((await context.params).id, patch));
  });
}
