import { z } from "zod";
import { handle, loadStyle, parseBody, withBrief } from "@/lib/api";
import { streamPlain } from "@/lib/llm";
import { sectionPrompt } from "@/lib/prompts";
import { sectionSchema } from "@/lib/types";

export const maxDuration = 300;

const body = withBrief.extend({
  sections: z.array(sectionSchema).min(1),
  index: z.number().int().min(0),
  previousTail: z.string(),
  /** 前面各章已用过的梗及次数 */
  memeUsage: z.record(z.string(), z.number()).default({}),
});

export async function POST(req: Request) {
  return handle(async () => {
    const { brief, modelId, sections, index, previousTail, memeUsage } = await parseBody(req, body);
    if (index >= sections.length) return Response.json({ error: "章节序号越界" }, { status: 400 });
    const { template, rate } = await loadStyle(brief);
    return streamPlain(modelId, sectionPrompt(brief, template, rate, sections, index, previousTail, memeUsage), req.signal);
  });
}
