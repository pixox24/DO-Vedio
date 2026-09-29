import { handle, loadStyle, parseBody, withSummary } from "@/lib/api";
import { normalizeMinutes } from "@/lib/duration";
import { stripOrdinalTitles } from "@/lib/humanize/detect";
import { generateJson } from "@/lib/llm";
import { normalizeOutlineMemes, outlinePrompt } from "@/lib/prompts";
import { outlineSchema } from "@/lib/types";

export const maxDuration = 120;

const ZERO_CHAPTER_MINUTES = 0.3;

export async function POST(req: Request) {
  return handle(async () => {
    const { brief, modelId } = await parseBody(req, withSummary);
    const { template, rate } = await loadStyle(brief);
    const raw = await generateJson(modelId, outlineSchema, outlinePrompt(brief, template, rate), req.signal);
    // 0 分钟的章节先给个最小时长，否则等比校正后仍是 0
    const sections = raw.sections.map((s) => ({ ...s, minutes: s.minutes > 0 ? s.minutes : ZERO_CHAPTER_MINUTES }));
    // 模型给的分钟数常常加起来不等于目标，按比例校正；通篇序号标题去掉编号（去 AI 味规则 6）
    // 用梗分配只留选中的梗、不重复、不超量
    return Response.json({ sections: normalizeOutlineMemes(stripOrdinalTitles(normalizeMinutes(sections, brief.minutes)), brief, template, rate) });
  });
}
