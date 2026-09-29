import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { voiceSettingsSchema } from "@/lib/core/types";
import { applyVoiceChange, cancelVoiceChange, finalizeVoiceChange, getVoiceChange, quoteVoiceChange, retryVoiceChange, revertVoiceChange } from "@/lib/server/voice-change";
import { getProject } from "@/lib/server/projects";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("quote"), voice: voiceSettingsSchema }),
  z.object({ action: z.literal("apply"), voice: voiceSettingsSchema }),
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("revert") }),
]);

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/voice-change">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getProject(id)) return fail("项目不存在", 404);
    finalizeVoiceChange(id);
    return Response.json({ change: getVoiceChange(id) });
  });
}

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/voice-change">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getProject(id)) return fail("项目不存在", 404);
    const input = await parseBody(req, body);
    try {
      if (input.action === "quote") return Response.json(quoteVoiceChange(id, input.voice));
      if (input.action === "apply") return Response.json({ change: applyVoiceChange(id, input.voice) });
      if (input.action === "retry") return Response.json({ change: retryVoiceChange(id) });
      if (input.action === "cancel") {
        cancelVoiceChange(id);
        return Response.json({ change: null });
      }
      revertVoiceChange(id);
      return Response.json({ change: null });
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error), 409);
    }
  });
}
