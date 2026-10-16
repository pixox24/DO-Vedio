import { randomUUID } from "crypto";
import { z } from "zod";
import { NoObjectGeneratedError } from "ai";
import { storyboardKey } from "../../core/keys";
import { quickHash } from "../../core/hash";
import { sanitizeCard } from "../../core/cards";
import { focusNumbersMatchSource, focusTextFromLegacy, focusVisualWidth, normalizeFocusText } from "../../core/focus";
import { distributeMotionCards, isMotionCardShot, normalizeShots, normalizeVideoShots, repairShots, sortShots, stampShots, blankShot, shotLineIds } from "../../core/shots";
import { buildTimeline, layoutLines } from "../../core/timeline";
import { previewSpecFor } from "../../core/output-spec";
import { anchorText, lookAt } from "../../core/cast";
import { MAX_SHOT_CHARACTERS } from "../../core/prompt-compiler";
import { videoDescriptionHash } from "../../core/video-plan";
import { sanitizeVideoPlan } from "../../core/video-prompt-compiler";
import { isVideoForm } from "../../core/video";
import { characterRoleLabels, motions, presentationLabels, shotSizeLabels, shotSizes, type Card, type Line, type ProjectDoc, type Shot } from "../../core/types";
import { generateJson } from "../../llm";
import { storyboardPrompt, type StoryboardPayload } from "../../prompts";
import { getTemplate } from "../../templates/store";
import { cacheGet, cachePut } from "../../server/cache";
import { mutateProject } from "../../server/projects";
import { loadArtifacts } from "../artifacts";
import { estimateLlmCost } from "../pricing";
import { defineStage, PermanentError } from "../stage";
import { beginGenerationRun, failGenerationRun, finishGenerationRun, noteGenerationRun } from "../../providers/runs";
import { syncVideoShotPlan } from "../video-plan-sync";

/**
 * 分镜：大模型先写意图、再选表达方式（生成画面 / 信息卡）、再出内容；规则定「节奏」。
 * 已有分镜时只重做过期的范围（覆盖的句子改过、又没锁定的镜头），其余不动。
 */

export const draftSchema = z.object({
  shots: z.array(
    z.object({
      lineId: z.string(),
      char: z.number().int().min(0).optional(),
      intent: z.string(),
      kind: z.literal("placeholder"),
      mode: z.enum(["generate", "motion"]),
      shotSize: z.enum(shotSizes).optional(),
      description: z.string(),
      focusText: z.object({
        text: z.string().trim().min(1).refine((value) => focusVisualWidth(value.replace(/\s+/g, "")) <= 8, "重点文字请概括为 8 字宽以内"),
        emphasis: z.string().optional(),
        support: z.string().refine((value) => focusVisualWidth(value.replace(/\s+/g, "")) <= 8, "辅助文字请概括为 8 字宽以内").optional(),
      }).optional(),
      /** 画面里出现的建卡角色 id */
      characters: z.array(z.string()).optional(),
      sceneId: z.string().optional(),
      motion: z.enum(motions),
      importance: z.number().int().min(1).max(3),
    }).strict().refine((shot) => shot.mode !== "motion" || !!shot.focusText, "文字镜头必须提炼 focusText"),
  ),
});
export const videoDraftSchema = z.object({ shots: z.array(z.object({
  lineId: z.string(), char: z.number().int().min(0).optional(), intent: z.string(),
  kind: z.literal("placeholder"), mode: z.literal("generate"), shotSize: z.enum(shotSizes),
  description: z.string(), motion: z.literal("none"), importance: z.number().int().min(1).max(3),
  groupId: z.string().trim().min(1),
  videoPlan: z.object({ startState: z.string().trim().min(1), action: z.string().trim().min(1), camera: z.string().trim().min(1), endState: z.string().trim().min(1) }).strict()
    .refine((plan) => Object.values(sanitizeVideoPlan(plan)).every((value) => /[a-z]/i.test(value) && !/[\u3400-\u9fff\uf900-\ufaff]/.test(value)), "视频执行计划必须使用英文"),
  characters: z.array(z.string()).optional(), sceneId: z.string().optional(),
  focusText: z.object({ text: z.string().trim().min(1).refine((value) => focusVisualWidth(value.replace(/\s+/g, "")) <= 8), emphasis: z.string().optional(), support: z.string().refine((value) => focusVisualWidth(value.replace(/\s+/g, "")) <= 8).optional() }).optional(),
}).strict()).min(1) });

export function toVideoShots(draft: z.infer<typeof videoDraftSchema>["shots"], lines: Line[], characterIds: Set<string>, sceneIds: Set<string>): Shot[] {
  const byAnchor = new Map(draft.map((entry) => [`${entry.lineId}:${entry.char ?? 0}`, entry]));
  return toShots(draft, lines, characterIds, sceneIds).map((shot) => {
    const entry = byAnchor.get(`${shot.at.lineId}:${shot.at.char}`) ?? draft.find((item) => item.lineId === shot.at.lineId);
    const caption = lines.map((line) => line.text).join("");
    const focus = entry?.focusText;
    const focusText = focus && focusNumbersMatchSource(focus.text, caption) ? {
      ...focus, support: focus.support && focusNumbersMatchSource(focus.support, caption) ? focus.support : undefined, layoutMode: "auto" as const,
    } : undefined;
    return { ...shot, kind: "video", mode: "generate", motion: "none", groupId: entry?.groupId, videoPlan: entry?.videoPlan && sanitizeVideoPlan(entry.videoPlan), videoPlanDescriptionHash: videoDescriptionHash(shot.description),
      focusText };
  });
}

/** Legacy draft shape is accepted only while converting cached/persisted content. */
type Draft = (Omit<z.infer<typeof draftSchema>["shots"][number], "kind"> & { kind: "placeholder" | "title" | "quote"; card?: Card; onScreenText?: string })[];

export type StoryboardInput = { projectId: string; modelId: string; mode: "full" | "stale"; shotId?: string; planFingerprint?: string };

/**
 * A storyboard draft is generated from a contiguous slice of lines. Apply it
 * only while the same IDs are still contiguous and their text is unchanged.
 * This rejects inserts, deletes, and reorders inside the slice before any
 * sourceHash is refreshed against the newer document.
 */
export function rangeMatchesCurrent(source: Line[], current: Line[], range: { from: number; to: number }): boolean {
  const slice = source.slice(range.from, range.to + 1);
  if (!slice.length) return false;
  const currentById = new Map(current.map((line, index) => [line.id, { line, index }]));
  const first = currentById.get(slice[0].id);
  if (!first) return false;
  const signature = (line: Line) => JSON.stringify({ segmentIndex: line.segmentIndex, text: line.text, keywords: line.keywords, mood: line.mood });
  return slice.every((line, offset) => {
    const found = currentById.get(line.id);
    return !!found && found.index === first.index + offset && signature(found.line) === signature(line);
  });
}

/** 需要重做的连续句子范围 */
export function staleRanges(doc: ProjectDoc): { from: number; to: number }[] {
  if (doc.shots.length === 0) return doc.lines.length ? [{ from: 0, to: doc.lines.length - 1 }] : [];
  if (isVideoForm(doc.settings.visualPipeline) && doc.shots.some((shot) => !shot.locked && !shot.videoPlan)) return doc.lines.length ? [{ from: 0, to: doc.lines.length - 1 }] : [];
  const { shots, stale } = repairShots(doc.shots, doc.lines, doc.lines);
  const order = new Map(doc.lines.map((l, k) => [l.id, k]));
  const sorted = sortShots(shots, doc.lines);
  const ranges: { from: number; to: number }[] = [];
  const addRange = (from: number, to: number) => {
    const last = ranges[ranges.length - 1];
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else ranges.push({ from, to: Math.max(from, to) });
  };
  sorted.forEach((s, k) => {
    if (!stale.has(s.id)) return;
    const from = order.get(s.at.lineId)!;
    const next = sorted[k + 1];
    const to = next ? order.get(next.at.lineId)! - (next.at.char === 0 ? 1 : 0) : doc.lines.length - 1;
    addRange(from, to);
  });
  // 旧项目可能已经保存了相邻信息卡；让下一次分镜任务重新编排并持久化交替结果。
  sorted.forEach((shot, index) => {
    const next = sorted[index + 1];
    if (!next || next.locked || !isMotionCardShot(shot) || !isMotionCardShot(next)) return;
    const from = order.get(shot.at.lineId)!;
    const to = order.get(next.at.lineId)!;
    addRange(from, to);
  });
  return ranges;
}

export function toShots(draft: Draft, lines: Line[], characterIds: Set<string> = new Set(), sceneIds: Set<string> = new Set()): Shot[] {
  const order = new Map(lines.map((l, k) => [l.id, k]));
  const text = new Map(lines.map((l) => [l.id, l.text]));

  // 数据清洗和验证：只过滤掉关键错误，对于其他问题记录警告但保留数据
  const cleaned = draft.filter((d, index) => {
    // 硬性要求：lineId 必须存在且有效
    if (!d.lineId || typeof d.lineId !== 'string') {
      console.warn(`镜头 ${index} 缺少 lineId，已跳过`);
      return false;
    }

    // 硬性要求：lineId 必须在句子列表中
    if (!order.has(d.lineId)) {
      console.warn(`镜头 ${index} lineId: ${d.lineId} 在句子列表中不存在，已跳过`);
      return false;
    }

    // 软性验证：记录警告但不过滤
    if (!d.intent || typeof d.intent !== 'string' || d.intent.trim() === '') {
      console.warn(`镜头 ${index} (lineId: ${d.lineId}) intent 缺失或为空，将使用默认值`);
    }
    if (!d.description || typeof d.description !== 'string' || d.description.trim() === '') {
      console.warn(`镜头 ${index} (lineId: ${d.lineId}) description 缺失或为空，将使用默认值`);
    }
    if (d.kind && !['title', 'quote', 'placeholder'].includes(d.kind)) {
      console.warn(`镜头 ${index} (lineId: ${d.lineId}) kind 值无效: ${d.kind}，将使用默认值`);
    }
    if (d.mode && !['generate', 'motion'].includes(d.mode)) {
      console.warn(`镜头 ${index} (lineId: ${d.lineId}) mode 值无效: ${d.mode}，将使用默认值`);
    }
    if (d.motion && !['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'none'].includes(d.motion)) {
      console.warn(`镜头 ${index} (lineId: ${d.lineId}) motion 值无效: ${d.motion}，将使用默认值`);
    }

    return true;
  });

  const valid = cleaned.sort((a, b) => order.get(a.lineId)! - order.get(b.lineId)! || (a.char ?? 0) - (b.char ?? 0));
  return distributeMotionCards(valid.map((d, k) => {
    const from = order.get(d.lineId)!;
    const next = valid[k + 1];
    const to = next ? Math.max(from, order.get(next.lineId)! - ((next.char ?? 0) === 0 ? 1 : 0)) : lines.length - 1;
    const caption = lines.slice(from, to + 1).map((l) => l.text).join("");
    const mode = d.kind === "placeholder" ? d.mode : "motion";
    const card = mode === "motion" && d.card ? sanitizeCard({
      ...d.card,
      stat: d.card.stat && { ...d.card.stat, label: d.card.stat.label ?? "" },
      sides: d.card.sides?.length === 2 ? [d.card.sides[0], d.card.sides[1]] : undefined,
      alert: d.card.alert,
      definition: d.card.definition,
      timeline: d.card.timeline,
      profile: d.card.profile,
    }, caption) : undefined;
    let focusText = mode === "motion" ? focusTextFromLegacy({ focusText: d.focusText && { ...d.focusText, layoutMode: "auto" }, card, onScreenText: d.onScreenText }, lines[from]?.keywords ?? [], caption) : undefined;
    if (focusText && (!normalizeFocusText(focusText.text) || !focusNumbersMatchSource(focusText.text, caption))) {
      focusText = focusTextFromLegacy({}, (lines[from]?.keywords ?? []).filter((word) => focusNumbersMatchSource(word, caption)), caption);
    }
    if (focusText?.support && !focusNumbersMatchSource(focusText.support, caption)) focusText = { ...focusText, support: undefined };
    return {
      ...blankShot(randomUUID(), d.lineId, Math.min(d.char ?? 0, Math.max(0, (text.get(d.lineId)?.length ?? 1) - 1))),
      kind: "placeholder",
      intent: d.intent.trim() || undefined,
      mode,
      shotSize: mode === "generate" ? (d.shotSize ?? "medium") : undefined,
      card: undefined,
      focusText,
      characterIds: mode === "generate" ? [...new Set((d.characters ?? []).filter((id) => characterIds.has(id)))].slice(0, MAX_SHOT_CHARACTERS) : [],
      sceneId: mode === "generate" && d.sceneId && sceneIds.has(d.sceneId) ? d.sceneId : undefined,
      description: d.description.trim(),
      onScreenText: undefined,
      motion: d.motion,
      importance: Math.min(3, Math.max(1, d.importance)) as 1 | 2 | 3,
    };
  }));
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
  if (isMotionCardShot(s)) return `重点文字「${s.focusText?.text ?? s.onScreenText ?? s.card?.headline ?? ""}」`;
  return [s.shotSize && shotSizeLabels[s.shotSize], s.description, s.videoPlan && `结束状态：${s.videoPlan.endState}`].filter(Boolean).join("，") || "画面待定";
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
    if (input.shotId) return syncVideoShotPlan({ ...input, shotId: input.shotId }, ctx);
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
    const video = isVideoForm(doc.settings.visualPipeline);
    const cast = castForStoryboard(doc);
    const castIds = new Set(cast.map((c) => c.id));

    const sourceRanges = input.mode === "full" ? (doc.lines.length ? [{ from: 0, to: doc.lines.length - 1 }] : []) : staleRanges(doc);
    // 视频草稿比图片草稿长得多。限制每次输出的句子数，成功片段照常缓存；
    // 格式错误时只缩小失败范围，不再重复提交整篇英文动作规划。
    const ranges = sourceRanges.flatMap((range) => {
      if (!video) return [range];
      const chunks: typeof sourceRanges = [];
      for (let from = range.from; from <= range.to; from += 6) chunks.push({ from, to: Math.min(from + 5, range.to) });
      return chunks;
    });
    const totalLines = ranges.reduce((total, range) => total + range.to - range.from + 1, 0);
    let completedLines = 0;
    let calls = 0;
    const fresh: Shot[] = [];
    for (let k = 0; k < ranges.length;) {
      if (!ctx.current()) throw ctx.signal.reason ?? new DOMException("任务已取消", "AbortError");
      const r = ranges[k];
      ctx.progress((completedLines + 0.1) / Math.max(1, totalLines), video ? `视频分镜 ${completedLines}/${totalLines} 句 · 第 ${k + 1}/${ranges.length} 段` : `第 ${k + 1}/${ranges.length} 段`);
      const slice = doc.lines.slice(r.from, r.to + 1);
      const partial = ranges.length === 1 && r.from === 0 && r.to === doc.lines.length - 1 ? undefined : partialContext(doc, r);
      if (video && partial && k > 0 && ranges[k - 1].to === r.from - 1 && fresh.length) {
        partial.before = { text: doc.lines[r.from - 1].text.slice(-30), shot: describeShot(fresh[fresh.length - 1]) };
      }
      const payload: StoryboardPayload = {
        title: doc.brief.title,
        visualPipeline: video ? "video" : undefined,
        visualStyle: video ? JSON.stringify(doc.visualStyle) : undefined,
        brief: { summary: doc.brief.summary, audience: doc.brief.audience, perspective: doc.brief.perspective },
        style: template && { name: template.name, description: template.description, tone: template.tone },
        segments: doc.segments.map((s, index) => ({ index, title: s.title, points: points[index] || undefined })),
        cast: cast.length ? cast.map((entry) => ({ ...entry, anchor: video ? slice.map((line) => `${line.id}: ${anchorText(doc.characters.find((card) => card.id === entry.id)!, lookAt(doc.characters.find((card) => card.id === entry.id)!, line.id, doc.lines))}`).join("\n") : undefined })) : undefined,
        scenes: doc.scenes.map(({ id, name, description }) => ({ id, name, description })),
        lines: slice.map((l) => ({ id: l.id, segmentIndex: l.segmentIndex, text: l.text, ms: ms.get(l.id) ?? 0, keywords: l.keywords, mood: l.mood, ...(video ? (() => { const time = laid.lines.find((item) => item.id === l.id)!; return { startMs: time.startMs, endMs: time.endMs, chars: time.chars, estimated: time.estimated }; })() : {}) })),
        partial,
      };
      const key = storyboardKey({ payload, modelId: input.modelId, ...(video ? { directorVersion: 3 } : {}) }, input.projectId);
      const splitRange = () => {
        const middle = Math.floor((r.from + r.to) / 2);
        ranges.splice(k, 1, { from: r.from, to: middle }, { from: middle + 1, to: r.to });
      };
      let draft = cacheGet<Draft>(key);
      if (!draft && video && r.from < r.to && cacheGet<{ split: boolean }>(`${key}:split`)?.split) {
        splitRange();
        continue;
      }
      if (!draft) {
        const prompt = storyboardPrompt(payload);
        const generation = beginGenerationRun({ projectId: input.projectId, jobId: ctx.job.id, providerId: input.modelId === "claude" ? "anthropic" : input.modelId, modelId: input.modelId, kind: "text", inputHash: key, params: { stage: "storyboard", lineCount: slice.length, range: [r.from, r.to] } });
        try {
          const raw = await generateJson(input.modelId, video ? videoDraftSchema : draftSchema, prompt, ctx.signal, video ? 0 : 2, video ? { maxOutputTokens: 8192 } : undefined);
          if (!ctx.current()) throw ctx.signal.reason ?? new DOMException("任务已取消", "AbortError");
          draft = raw.shots;
          cachePut(key, "storyboard", draft);
          calls++;
          const costYuan = estimateLlmCost(input.modelId, prompt.instructions.length + prompt.prompt.length, JSON.stringify(draft).length);
          const ledgerId = ctx.spend({ provider: input.modelId, model: input.modelId, unit: "call", quantity: 1, costYuan });
          finishGenerationRun(generation.id, { status: "succeeded", latencyMs: Date.now() - generation.startedAt, costYuan, ledgerId });
        } catch (e) {
          failGenerationRun(generation, e, ctx.signal.aborted);
          if (video && NoObjectGeneratedError.isInstance(e) && ctx.current()) {
            const canSplit = r.from < r.to;
            noteGenerationRun(generation.id, { finishReason: e.finishReason, responseChars: e.text?.length ?? 0, usage: e.usage, recovery: canSplit ? "split-range" : "stopped" });
            if (canSplit) {
              cachePut(`${key}:split`, "storyboard", { split: true });
              splitRange();
              ctx.log(`视频分镜第 ${r.from + 1}–${r.to + 1} 句响应无法解析，缩小范围继续（${e.finishReason ?? "unknown"}）。`);
              continue;
            }
            throw new PermanentError(`第 ${r.from + 1} 句视频分镜${e.finishReason === "length" ? "输出达到长度上限" : "返回的 JSON 格式不正确"}，已停止自动重试。请切换文本模型后重新生成成片。`);
          }
          throw e;
        }
      }
      if (!ctx.current()) throw ctx.signal.reason ?? new DOMException("任务已取消", "AbortError");
      const shots = video ? toVideoShots(videoDraftSchema.parse({ shots: draft }).shots, slice, castIds, new Set(doc.scenes.map((scene) => scene.id))) : toShots(draft, slice, castIds, new Set(doc.scenes.map((scene) => scene.id)));
      // 保证范围的第一句有镜头
      if (!shots.some((s) => s.at.lineId === slice[0].id && s.at.char === 0)) shots.unshift(video && shots[0] ? { ...shots[0], id: randomUUID(), at: { lineId: slice[0].id, char: 0 } } : blankShot(randomUUID(), slice[0].id));
      fresh.push(...shots);
      completedLines += slice.length;
      k++;
      ctx.progress(completedLines / Math.max(1, totalLines), video ? `视频分镜 ${completedLines}/${totalLines} 句` : `第 ${k}/${ranges.length} 段完成`);
    }

    if (!ctx.current()) throw ctx.signal.reason ?? new DOMException("任务已取消", "AbortError");

    // 写回：只替换仍与生成时一致的范围。文案在生成期间变化时，保留
    // 当前镜头及其旧 sourceHash，让编排层在下一轮继续识别为过期。
    let count = 0;
    mutateProject(input.projectId, (cur) => {
      if (!ctx.current() || cur.settings.visualPipeline !== doc.settings.visualPipeline) return null;
      const lineIds = new Set(cur.lines.map((l) => l.id));
      const replaced = new Set<string>();
      ranges.forEach((r) => {
        if (!rangeMatchesCurrent(doc.lines, cur.lines, r)) return;
        if (video) {
          const ids = new Set(doc.lines.slice(r.from, r.to + 1).map((line) => line.id));
          const semanticShots = (source: ProjectDoc) => source.shots.filter((shot) => ids.has(shot.at.lineId)).map((shot) => ({
            id: shot.id, at: shot.at, description: shot.description, plan: shot.videoPlan, descriptionHash: shot.videoPlanDescriptionHash,
            characters: shot.characterIds, scene: shot.sceneId, locked: shot.locked, shotSize: shot.shotSize, focusText: shot.focusText,
          }));
          if (quickHash(semanticShots(doc)) !== quickHash(semanticShots(cur))) return;
        }
        for (const l of doc.lines.slice(r.from, r.to + 1)) replaced.add(l.id);
      });
      const keep = cur.shots.filter((s) => s.locked || !replaced.has(s.at.lineId));
      const keepAt = new Set(keep.map((s) => `${s.at.lineId}:${s.at.char}`));
      const merged = [...keep, ...fresh.filter((s) => replaced.has(s.at.lineId) && lineIds.has(s.at.lineId) && !keepAt.has(`${s.at.lineId}:${s.at.char}`))];
      const curArt = loadArtifacts(cur, input.projectId);
      const curLaid = layoutLines(cur.lines, curArt);
      const times = new Map(curLaid.lines.map((l) => [l.id, l]));
      const totalMs = video ? buildTimeline(cur, curArt, previewSpecFor(cur.settings)).durationMs : curLaid.endMs;
      const normalized = (video ? normalizeVideoShots : normalizeShots)(merged, cur.lines, times, totalMs, () => randomUUID());
      const stampedFreshIds = new Set(fresh.map((s) => s.id));
      const existingById = new Map(cur.shots.map((s) => [s.id, s]));
      const editableIds = new Set(normalized.filter((s) => stampedFreshIds.has(s.id) || (!existingById.has(s.id) && replaced.has(s.at.lineId))).map((s) => s.id));
      const spaced = video ? sortShots(normalized, cur.lines) : distributeMotionCards(sortShots(normalized, cur.lines), editableIds);
      const stamped = stampShots(spaced, cur.lines).map((s) => {
        // Keep concurrent/current shots' sourceHash untouched. Only drafts
        // generated from a matching snapshot (and normalization shots inside
        // an applied range) receive a hash for the current text.
        if (stampedFreshIds.has(s.id)) return s;
        if (!existingById.has(s.id)) return replaced.has(s.at.lineId) ? s : { ...s, sourceHash: "" };
        return { ...s, sourceHash: existingById.get(s.id)!.sourceHash };
      });
      count = stamped.length;
      return { ...cur, shots: stamped };
    });
    return { shots: count, llmCalls: calls };
  },
});
