import { viralCommandSchema } from "@/lib/viral/schemas";
import { viralBody, viralHandle, viralSuccess } from "@/lib/server/viral/errors";
import { commandDraft } from "@/lib/server/viral/tasks";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return viralHandle(async () => {
    const command = await viralBody(request, viralCommandSchema);
    return viralSuccess(commandDraft((await context.params).id, command));
  });
}
