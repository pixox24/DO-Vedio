import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { addCustomVoice, VoiceBookError } from "@/lib/server/custom-voices";

const body = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1).max(80),
  voiceId: z.string(),
  name: z.string().optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    const input = await parseBody(req, body);
    try {
      return Response.json({ voice: addCustomVoice(input) }, { status: 201 });
    } catch (error) {
      if (error instanceof VoiceBookError) return fail(error.message, error.status);
      throw error;
    }
  });
}
