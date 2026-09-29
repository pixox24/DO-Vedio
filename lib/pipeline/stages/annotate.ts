import { z } from "zod";
import { annotateKey } from "../../core/keys";
import { spansValid } from "../../core/lines";
import { moods, type Line, type Mood, type Span } from "../../core/types";
import { generateJson } from "../../llm";
import { annotatePrompt } from "../../prompts";
import { cacheGet, cachePut } from "../../server/cache";
import { effectiveLexicon } from "../../server/lexicon";
import { mutateProject } from "../../server/projects";
import { defineStage } from "../stage";
import { estimateLlmCost } from "../pricing";
import { beginGenerationRun, failGenerationRun, finishGenerationRun } from "../../providers/runs";

/** 断句标注：一个段落一次大模型调用，产出读音、停顿、关键词、情绪 */

export type AnnotateInput = {
  projectId: string;
  modelId: string;
  title: string;
  segmentTitle: string;
  lines: { id: string; text: string }[];
};

export type Annotation = { id: string; spans: Span[]; pauseAfterMs?: number; keywords: string[]; mood?: Mood };

const outSchema = z.object({
  lines: z.array(
    z.object({
      id: z.string(),
      spans: z.array(z.object({ text: z.string(), say: z.string().optional() })),
      pauseAfterMs: z.number().optional(),
      keywords: z.array(z.string()),
      mood: z.enum(moods),
    }),
  ),
});

/** 校验并清洗模型输出：标注拼不回原文就丢弃，关键词必须在原句里 */
export function sanitize(lines: { id: string; text: string }[], raw: z.infer<typeof outSchema>): Annotation[] {
  const byId = new Map(raw.lines.map((l) => [l.id, l]));
  return lines.map((line) => {
    const a = byId.get(line.id);
    if (!a) return { id: line.id, spans: [], keywords: [] };
    const spans = a.spans
      .filter((s) => s.text.length > 0)
      .map((s) => (s.say && s.say.trim() && s.say !== s.text && !/[<>{}]/.test(s.say) ? { text: s.text, say: s.say.trim() } : { text: s.text }));
    const ok = spansValid(line.text, spans) && spans.some((s) => s.say !== undefined);
    return {
      id: line.id,
      spans: ok ? spans : [],
      pauseAfterMs: a.pauseAfterMs && a.pauseAfterMs > 0 ? Math.min(2000, Math.round(a.pauseAfterMs)) : undefined,
      keywords: [...new Set(a.keywords.map((k) => k.trim()).filter((k) => k.length >= 2 && k.length <= 12 && line.text.includes(k)))].slice(0, 2),
      mood: a.mood,
    };
  });
}

/** 把标注写回文档：只改 ID 和原文都没变、且未锁定的句子 */
export function applyAnnotations(lines: Line[], ann: Annotation[], source: { id: string; text: string }[]): Line[] {
  const textById = new Map(source.map((s) => [s.id, s.text]));
  const byId = new Map(ann.map((a) => [a.id, a]));
  return lines.map((l) => {
    const a = byId.get(l.id);
    if (!a || l.locked || textById.get(l.id) !== l.text) return l;
    return { ...l, spans: a.spans, pauseAfterMs: a.pauseAfterMs ?? l.pauseAfterMs, keywords: a.keywords, mood: a.mood ?? l.mood };
  });
}

export const annotateStage = defineStage<AnnotateInput, { count: number }>({
  name: "annotate",
  concurrency: 2,
  async run(input, ctx) {
    const lex = effectiveLexicon(input.projectId);
    const key = annotateKey(input.lines, lex, input.modelId);
    let ann = cacheGet<Annotation[]>(key);
    if (!ann) {
      ctx.progress(0.1, "大模型标注中");
      const prompt = annotatePrompt(input.lines, { title: input.title, segmentTitle: input.segmentTitle, lexicon: lex });
      const generation = beginGenerationRun({ projectId: input.projectId, jobId: ctx.job.id, providerId: input.modelId === "claude" ? "anthropic" : input.modelId, modelId: input.modelId, kind: "text", inputHash: key, params: { stage: "annotate", lineCount: input.lines.length } });
      try {
        const raw = await generateJson(input.modelId, outSchema, prompt, ctx.signal);
        if (!ctx.current()) throw ctx.signal.reason ?? new DOMException("任务已取消", "AbortError");
        ann = sanitize(input.lines, raw);
        cachePut(key, "annotate", ann);
        const chars = prompt.instructions.length + prompt.prompt.length;
        const costYuan = estimateLlmCost(input.modelId, chars, JSON.stringify(raw).length);
        const ledgerId = ctx.spend({ provider: input.modelId, model: input.modelId, unit: "call", quantity: 1, costYuan });
        finishGenerationRun(generation.id, { status: "succeeded", latencyMs: Date.now() - generation.startedAt, costYuan, ledgerId });
      } catch (e) {
        failGenerationRun(generation, e, ctx.signal.aborted);
        throw e;
      }
    }
    if (!ctx.current()) throw ctx.signal.reason ?? new DOMException("任务已取消", "AbortError");
    mutateProject(input.projectId, (doc) => {
      if (!ctx.current()) return null;
      return { ...doc, lines: applyAnnotations(doc.lines, ann!, input.lines) };
    });
    return { count: ann.length };
  },
});
