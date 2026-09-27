import { randomUUID } from "crypto";
import { z } from "zod";
import { storyboardKey } from "../../core/keys";
import { sanitizeCard } from "../../core/cards";
import { normalizeShots, repairShots, sortShots, stampShots, blankShot, shotLineIds } from "../../core/shots";
import { layoutLines } from "../../core/timeline";
import { MAX_SHOT_CHARACTERS } from "../../core/prompt-compiler";
import { cardVariants, characterRoleLabels, motions, presentationLabels, shotSizeLabels, shotSizes, type Line, type ProjectDoc, type Shot } from "../../core/types";
import { generateJson } from "../../llm";
import { storyboardPrompt, type StoryboardPayload } from "../../prompts";
import { getTemplate } from "../../templates/store";
import { cacheGet, cachePut } from "../../server/cache";
import { mutateProject } from "../../server/projects";
import { loadArtifacts } from "../artifacts";
import { estimateLlmCost } from "../pricing";
import { defineStage } from "../stage";
import { beginGenerationRun, failGenerationRun, finishGenerationRun } from "../../providers/runs";

/**
 * 分镜：大模型先写意图、再选表达方式（生成画面 / 信息卡）、再出内容；规则定「节奏」。
 * 已有分镜时只重做过期的范围（覆盖的句子改过、又没锁定的镜头），其余不动。
 */

const draftSchema = z.object({
  shots: z.array(
    z.object({
      lineId: z.string(),
      char: z.number().int().min(0).optional(),
      intent: z.string(),
      kind: z.enum(["title", "quote", "placeholder"]),
      mode: z.enum(["generate", "motion"]),
      shotSize: z.enum(shotSizes).optional(),
      description: z.string(),
      card: z
        .object({
          variant: z.enum(cardVariants),
          headline: z.string().optional(),
          stat: z.object({ value: z.string(), unit: z.string().optional(), label: z.string().optional() }).optional(),
          items: z.array(z.string()).optional(),
          sides: z.array(z.string()).optional(),
        })
        .optional(),
      onScreenText: z.string().optional(),
      /** 画面里出现的建卡角色 id */
      characters: z.array(z.string()).optional(),
      motion: z.enum(motions),
      importance: z.number().int().min(1).max(3),
    }),
  ),
});
type Draft = z.infer<typeof draftSchema>["shots"];

export type StoryboardInput = { projectId: string; modelId: string; mode: "full" | "stale" };

/** 需要重做的连续句子范围 */
export function staleRanges(doc: ProjectDoc): { from: number; to: number }[] {
  if (doc.shots.length === 0) return doc.lines.length ? [{ from: 0, to: doc.lines.length - 1 }] : [];
  const { shots, stale } = repairShots(doc.shots, doc.lines, doc.lines);
  const order = new Map(doc.lines.map((l, k) => [l.id, k]));
  const sorted = sortShots(shots, doc.lines);
  const ranges: { from: number; to: number }[] = [];
  sorted.forEach((s, k) => {
    if (!stale.has(s.id)) return;
    const from = order.get(s.at.lineId)!;
    const next = sorted[k + 1];
    const to = next ? order.get(next.at.lineId)! - (next.at.char === 0 ? 1 : 0) : doc.lines.length - 1;
    const last = ranges[ranges.length - 1];
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else ranges.push({ from, to: Math.max(from, to) });
  });
  return ranges;
}

export function toShots(draft: Draft, lines: Line[], characterIds: Set<string> = new Set()): Shot[] {
  const order = new Map(lines.map((l, k) => [l.id, k]));
  const text = new Map(lines.map((l) => [l.id, l.text]));
  const valid = draft.filter((d) => order.has(d.lineId)).sort((a, b) => order.get(a.lineId)! - order.get(b.lineId)! || (a.char ?? 0) - (b.char ?? 0));
  return valid.map((d, k) => {
    const from = order.get(d.lineId)!;
    const next = valid[k + 1];
    const to = next ? Math.max(from, order.get(next.lineId)! - ((next.char ?? 0) === 0 ? 1 : 0)) : lines.length - 1;
    const caption = lines.slice(from, to + 1).map((l) => l.text).join("");
    const placeholder = d.kind === "placeholder";
    const mode = placeholder ? d.mode : "motion";
    const card = placeholder && mode === "motion" && d.card ? sanitizeCard({ ...d.card, stat: d.card.stat && { ...d.card.stat, label: d.card.stat.label ?? "" }, sides: d.card.sides?.length === 2 ? [d.card.sides[0], d.card.sides[1]] : undefined }, caption) : undefined;
    return {
      ...blankShot(randomUUID(), d.lineId, Math.min(d.char ?? 0, Math.max(0, (text.get(d.lineId)?.length ?? 1) - 1))),
      kind: d.kind,
      intent: d.intent.trim() || undefined,
      mode,
      shotSize: mode === "generate" ? (d.shotSize ?? "medium") : undefined,
      card,
      characterIds: mode === "generate" ? [...new Set((d.characters ?? []).filter((id) => characterIds.has(id)))].slice(0, MAX_SHOT_CHARACTERS) : [],
      description: d.description.trim(),
      onScreenText: d.onScreenText?.trim() || undefined,
      motion: d.motion,
      importance: Math.min(3, Math.max(1, d.importance)) as 1 | 2 | 3,
    };
  });
}

/** 分镜要知道的角色：未缺席的建卡角色，外貌只给摘要（完整外貌由编译器注入） */
export function castForStoryboard(doc: ProjectDoc): NonNullable<StoryboardPayload["cast"]> {
  return doc.characters
    .filter((c) => !c.absent)
    .map((c) => ({
      id: c.id,
      name: c.name,
      role: characterRoleLabels[c.role],
      brief: [c.ageRange, c.gender, c.occupation, ...c.signature].filter(Boolean).join("，") || "外貌见角色卡",
      presentation: c.presentation !== "full" ? `只拍${presentationLabels[c.presentation]}` : undefined,
    }));
}

/** 给大模型看的镜头摘要（局部重做时描述前后的镜头） */
export function describeShot(s: Shot): string {
  if (s.kind === "title") return `章节标题卡「${s.onScreenText ?? ""}」`;
  if (s.kind === "quote") return `金句卡「${s.onScreenText ?? ""}」`;
  if (s.mode === "motion") return `信息卡（${s.card?.variant ?? "headline"}${s.card?.headline ? `：${s.card.headline}` : ""}）`;
  return [s.shotSize && shotSizeLabels[s.shotSize], s.description].filter(Boolean).join("，") || "画面待定";
}

/** 局部重做的前后文：相邻句子 + 相邻镜头（之前取覆盖前一句的最后一个镜头，之后取从后一句开始的镜头） */
export function partialContext(doc: ProjectDoc, r: { from: number; to: number }): StoryboardPayload["partial"] {
  const sorted = sortShots(doc.shots, doc.lines);
  const covers = shotLineIds(sorted, doc.lines);
  const prev = doc.lines[r.from - 1];
  const next = doc.lines[r.to + 1];
  const prevShot = prev && sorted.filter((s) => covers.get(s.id)?.includes(prev.id)).at(-1);
  const nextShot = next && sorted.find((s) => s.at.lineId === next.id);
  return {
    before: prev && { text: prev.text.slice(-30), shot: prevShot ? describeShot(prevShot) : undefined },
    after: next && { text: next.text.slice(0, 30), shot: nextShot ? describeShot(nextShot) : undefined },
  };
}

export const storyboardStage = defineStage<StoryboardInput, { shots: number; llmCalls: number }>({
  name: "storyboard",
  concurrency: 2,
  async run(input, ctx) {
    const { getProject } = await import("../../server/projects");
    const project = getProject(input.projectId);
    if (!project) throw new Error("项目不存在");
    const doc = project.doc;
    const art = loadArtifacts(doc, input.projectId);
    const laid = layoutLines(doc.lines, art);
    const ms = new Map(laid.lines.map((l) => [l.id, l.endMs - l.startMs]));
    const template = await getTemplate(doc.brief.templateId).catch(() => undefined);
    // 章节与大纲一一对应时带上本章要点
    const points = doc.sections.length === doc.segments.length ? doc.sections.map((x) => x.points) : [];
    const cast = castForStoryboard(doc);
    const castIds = new Set(cast.map((c) => c.id));

    const ranges = input.mode === "full" ? (doc.lines.length ? [{ from: 0, to: doc.lines.length - 1 }] : []) : staleRanges(doc);
    let calls = 0;
    const fresh: Shot[] = [];
    for (const [k, r] of ranges.entries()) {
      ctx.progress((k + 0.1) / Math.max(1, ranges.length), `第 ${k + 1}/${ranges.length} 段`);
      const slice = doc.lines.slice(r.from, r.to + 1);
      const payload: StoryboardPayload = {
        title: doc.brief.title,
        brief: { summary: doc.brief.summary, audience: doc.brief.audience, perspective: doc.brief.perspective },
        style: template && { name: template.name, description: template.description, tone: template.tone },
        segments: doc.segments.map((s, index) => ({ index, title: s.title, points: points[index] || undefined })),
        cast: cast.length ? cast : undefined,
        lines: slice.map((l) => ({ id: l.id, segmentIndex: l.segmentIndex, text: l.text, ms: ms.get(l.id) ?? 0, keywords: l.keywords, mood: l.mood })),
        partial: ranges.length === 1 && r.from === 0 && r.to === doc.lines.length - 1 ? undefined : partialContext(doc, r),
      };
      const key = storyboardKey({ payload, modelId: input.modelId });
      let draft = cacheGet<Draft>(key);
      if (!draft) {
        const prompt = storyboardPrompt(payload);
        const generation = beginGenerationRun({ projectId: input.projectId, jobId: ctx.job.id, providerId: input.modelId === "claude" ? "anthropic" : input.modelId, modelId: input.modelId, kind: "text", inputHash: key, params: { stage: "storyboard", lineCount: slice.length, range: [r.from, r.to] } });
        try {
          const raw = await generateJson(input.modelId, draftSchema, prompt);
          draft = raw.shots;
          cachePut(key, "storyboard", draft);
          calls++;
          const costYuan = estimateLlmCost(input.modelId, prompt.instructions.length + prompt.prompt.length, JSON.stringify(draft).length);
          const ledgerId = ctx.spend({ provider: input.modelId, model: input.modelId, unit: "call", quantity: 1, costYuan });
          finishGenerationRun(generation.id, { status: "succeeded", latencyMs: Date.now() - generation.startedAt, costYuan, ledgerId });
        } catch (e) {
          failGenerationRun(generation, e, ctx.signal.aborted);
          throw e;
        }
      }
      const shots = toShots(draft, slice, castIds);
      // 保证范围的第一句有镜头
      if (!shots.some((s) => s.at.lineId === slice[0].id && s.at.char === 0)) shots.unshift(blankShot(randomUUID(), slice[0].id));
      fresh.push(...shots);
    }

    // 写回：以最新文档为准；期间句子被改了的部分下次对账再处理
    let count = 0;
    mutateProject(input.projectId, (cur) => {
      const lineIds = new Set(cur.lines.map((l) => l.id));
      const replaced = new Set<string>();
      for (const r of ranges) for (const l of doc.lines.slice(r.from, r.to + 1)) replaced.add(l.id);
      const keep = input.mode === "full" ? cur.shots.filter((s) => s.locked) : cur.shots.filter((s) => s.locked || !replaced.has(s.at.lineId));
      const keepAt = new Set(keep.map((s) => `${s.at.lineId}:${s.at.char}`));
      const merged = [...keep, ...fresh.filter((s) => lineIds.has(s.at.lineId) && !keepAt.has(`${s.at.lineId}:${s.at.char}`))];
      const curArt = loadArtifacts(cur, input.projectId);
      const curLaid = layoutLines(cur.lines, curArt);
      const times = new Map(curLaid.lines.map((l) => [l.id, l]));
      const normalized = normalizeShots(merged, cur.lines, times, curLaid.endMs, () => randomUUID());
      const stamped = stampShots(normalized, cur.lines).map((s) => (s.locked ? (cur.shots.find((x) => x.id === s.id) ?? s) : s));
      count = stamped.length;
      return { ...cur, shots: stamped };
    });
    return { shots: count, llmCalls: calls };
  },
});
