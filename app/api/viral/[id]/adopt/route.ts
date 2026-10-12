import { viralAdoptSchema } from "@/lib/viral/schemas";
import { viralBody, viralHandle, viralSuccess } from "@/lib/server/viral/errors";
import { adoptViralDraft } from "@/lib/server/viral/handoff";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return viralHandle(async () => viralSuccess(adoptViralDraft((await context.params).id, await viralBody(request, viralAdoptSchema))));
}
