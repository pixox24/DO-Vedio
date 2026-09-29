import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { generateJson } from "@/lib/llm";
import { extractPrompt } from "@/lib/prompts";
import { templateInputSchema } from "@/lib/types";

export const maxDuration = 120;

const body = z.object({
  modelId: z.string().min(1, "请选择模型"),
  samples: z.array(z.string().trim()).transform((a) => a.filter(Boolean)).pipe(z.array(z.string()).min(1, "请至少粘贴一篇样本文案")),
});

export async function POST(req: Request) {
  return handle(async () => {
    const { modelId, samples } = await parseBody(req, body);
    const joined = samples.map((s, i) => `【样本 ${i + 1}】\n${s}`).join("\n\n");
    return Response.json(await generateJson(modelId, templateInputSchema, extractPrompt(joined), req.signal));
  });
}
