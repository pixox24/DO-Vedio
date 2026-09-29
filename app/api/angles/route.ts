import { z } from "zod";
import { handle, loadStyle, parseBody, withBrief } from "@/lib/api";
import { generateJson } from "@/lib/llm";
import { anglesPrompt } from "@/lib/prompts";
import { anglesSchema } from "@/lib/types";

export const maxDuration = 120;

const body = withBrief.extend({ exclude: z.array(z.string()).default([]) });

export async function POST(req: Request) {
  return handle(async () => {
    const { brief, modelId, exclude } = await parseBody(req, body);
    const { template } = await loadStyle(brief);
    const { angles } = await generateJson(modelId, anglesSchema, anglesPrompt(brief, template, exclude), req.signal);
    return Response.json({ angles: angles.slice(0, 3) });
  });
}
