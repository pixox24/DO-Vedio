import { z } from "zod";
import { handle, parseBody, withBrief } from "@/lib/api";
import { generateJson } from "@/lib/llm";
import { metadataPrompt } from "@/lib/prompts";
import { metadataSchema } from "@/lib/types";

export const maxDuration = 120;

const body = withBrief.extend({ script: z.string().min(1, "请先生成文案") });

export async function POST(req: Request) {
  return handle(async () => {
    const { brief, modelId, script } = await parseBody(req, body);
    return Response.json(await generateJson(modelId, metadataSchema, metadataPrompt(brief, script)));
  });
}
