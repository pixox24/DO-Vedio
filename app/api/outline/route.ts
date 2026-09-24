import { handle, loadStyle, parseBody, withSummary } from "@/lib/api";
import { normalizeMinutes } from "@/lib/duration";
import { generateJson } from "@/lib/llm";
import { outlinePrompt } from "@/lib/prompts";
import { outlineSchema } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: Request) {
  return handle(async () => {
    const { brief, modelId } = await parseBody(req, withSummary);
    const { template, rate } = await loadStyle(brief);
    const { sections } = await generateJson(modelId, outlineSchema, outlinePrompt(brief, template, rate));
    // 模型给的分钟数常常加起来不等于目标，按比例校正
    return Response.json({ sections: normalizeMinutes(sections, brief.minutes) });
  });
}
