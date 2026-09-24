import { z } from "zod";
import { fail, handle, loadStyle, parseBody, withBrief } from "@/lib/api";
import { streamPlain } from "@/lib/llm";
import { rewritePrompt } from "@/lib/prompts";
import { getTemplate } from "@/lib/templates/store";

export const maxDuration = 120;

const body = withBrief.extend({
  action: z.enum(["expand", "shrink", "colloquial", "restyle", "custom", "fit"]),
  text: z.string().min(1, "段落为空"),
  before: z.string(),
  after: z.string(),
  targetChars: z.number().int().positive().optional(),
  instruction: z.string().optional(),
  restyleId: z.string().optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    const { brief, modelId, restyleId, ...input } = await parseBody(req, body);
    if (input.action === "custom" && !input.instruction?.trim()) throw fail("请填写修改要求");
    if (input.action === "fit" && !input.targetChars) throw fail("缺少目标字数");
    const { template } = await loadStyle(brief);
    const restyle = restyleId ? await getTemplate(restyleId) : undefined;
    return streamPlain(modelId, rewritePrompt(brief, template, { ...input, restyle }), req.signal);
  });
}
