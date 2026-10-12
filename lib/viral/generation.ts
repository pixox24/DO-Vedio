import { randomUUID } from "node:crypto";
import { z } from "zod";
import { countChars, deviation, secondsFor, TOLERANCE } from "../duration";
import { acceptHumanized, detectAiTone } from "../humanize/detect";
import { humanizePrompt } from "../prompts";
import { speechRates, type Brief } from "../types";
import { validMaterialIds } from "./evidence";
import { contextBlock, generationRules, viralLLM, type ViralLLM } from "./prompts";
import { asViralTemplate } from "./style";
import type { ViralGenerationContext, ViralInputSnapshot, ViralOutline, ViralScriptVersion, ViralSegment, ViralTaskSnapshot } from "./types";

export type ViralGenerationOptions = {
  signal?: AbortSignal;
  llm?: ViralLLM;
  onVersion?: (version: ViralScriptVersion) => Promise<void> | void;
  versionId?: string;
  /** Used only to scrub our own candidate; this list never enters a model prompt. */
  protectedText?: readonly string[];
};

export const outlineOutputSchema = z.object({ sections: z.array(z.object({
  title: z.string().trim().min(1), function: z.string(), points: z.array(z.string().trim().min(1)).min(1),
  seconds: z.number().positive(), materialIds: z.array(z.string()),
})).min(1).max(30) });
const titleOutputSchema = z.object({ title: z.string().trim().min(1).max(200) });

export function outlinePrompt(context: ViralGenerationContext) {
  return {
    instructions: generationRules(context),
    prompt: `${contextBlock(context)}\n按当前所选角度及其证据路线生成一个新大纲，不额外换主题或论证。先核对角度的具体事实是否被本期素材实质支持，不能把角度中的待证错因或事件变成必须写出的要点；不支持时保留该步功能，改用材料支持的判断或操作。每段给功能、要点、正数秒数和真实关联素材ID；使用构造数据/假设场景的要点保留其性质和范围限定。全部秒数合计等于本期目标秒数，至少一段。短稿围绕单一问题连续展开，中长稿可分章。开头和结尾按平台与任务安排，不固定10–20秒开场，也不统一插入点赞投币。`,
  };
}

export async function generateViralOutline(context: ViralGenerationContext, modelId: string, sourceFingerprint: string, options: ViralGenerationOptions = {}): Promise<ViralOutline> {
  if (!context.selectedAngle) throw new Error("请先确定本期角度");
  const raw = outlineOutputSchema.parse(await (options.llm ?? viralLLM).json(modelId, outlineOutputSchema, outlinePrompt(context), options.signal));
  const sum = raw.sections.reduce((total, section) => total + section.seconds, 0);
  return {
    id: randomUUID(), sourceFingerprint, createdAt: new Date().toISOString(),
    sections: raw.sections.map((section) => ({ ...section, id: randomUUID(), seconds: section.seconds / sum * context.task.targetSeconds, materialIds: validMaterialIds(section.materialIds, context.materials) })),
  };
}

export function inputSnapshot(snapshot: ViralTaskSnapshot): ViralInputSnapshot {
  return structuredClone({ input: snapshot.input, mechanisms: snapshot.mechanisms, selectedAngle: snapshot.selectedAngle, outline: snapshot.outline });
}

export function scriptStats(version: Pick<ViralScriptVersion, "segments">, context: Pick<ViralGenerationContext, "task" | "style">) {
  const text = version.segments.map((segment) => segment.text).join("\n\n");
  const rate = context.task.rate === "auto" ? context.style.speechRate : context.task.rate;
  const estimatedSeconds = secondsFor(text, rate);
  return { chars: countChars(text), estimatedSeconds, deviation: deviation(estimatedSeconds, context.task.targetSeconds), needsCalibration: Math.abs(deviation(estimatedSeconds, context.task.targetSeconds)) > TOLERANCE };
}

export function scrubProtectedText(text: string, protectedText: readonly string[] = []): string {
  let result = text;
  for (const distinctive of protectedText) if (distinctive.trim()) result = result.split(distinctive).join("");
  return result;
}

function briefFor(context: ViralGenerationContext, title: string): Brief {
  return {
    title, summary: "", minutes: context.task.targetSeconds / 60, templateId: context.style.templateId,
    audience: context.task.audience, perspective: context.task.perspective, mustInclude: context.task.mustInclude.join("\n"), avoid: context.task.avoid.join("\n"),
    rate: context.task.rate, slang: "off", memes: [], groundedEnabled: false, groundedLevel: "medium",
  };
}

async function humanizeSegment(text: string, context: ViralGenerationContext, title: string, modelId: string, options: ViralGenerationOptions): Promise<string> {
  if (!context.task.humanize || !detectAiTone(text).length) return text;
  // A candidate which happens to contain a protected source expression goes to comparison first.
  if (scrubProtectedText(text, options.protectedText) !== text) return text;
  const prompt = humanizePrompt(briefFor(context, title), asViralTemplate(context.style), { text, before: "", after: "" });
  const after = await (options.llm ?? viralLLM).plain(modelId, {
    instructions: `${generationRules(context)}\n${prompt.instructions}\n这一步仅调整本段语言，不能新增事实或因果；构造/假设/示例标记及样本范围限定必须保留，不把示例改成亲历实测。`,
    prompt: `${contextBlock(context)}\n${prompt.prompt}`,
  }, options.signal);
  return acceptHumanized(text, after).ok ? after.trim() : text;
}

async function titleFor(context: ViralGenerationContext, modelId: string, options: ViralGenerationOptions): Promise<string> {
  const result = titleOutputSchema.parse(await (options.llm ?? viralLLM).json(modelId, titleOutputSchema, {
    instructions: generationRules(context),
    prompt: `${contextBlock(context)}\n为当前角度和大纲起一个准确的新标题，只写有素材支持的承诺，避免夸大与编造数据。`,
  }, options.signal));
  return result.title;
}

async function checkpoint(version: ViralScriptVersion, options: ViralGenerationOptions) {
  options.signal?.throwIfAborted();
  await options.onVersion?.(structuredClone(version));
}

export function sectionPrompt(context: ViralGenerationContext, section: ViralOutline["sections"][number], index: number, previous: string) {
  const rate = speechRates[context.task.rate === "auto" ? context.style.speechRate : context.task.rate];
  return {
    instructions: generationRules(context),
    prompt: `${contextBlock(context)}\n现在只写第${index + 1}段的口播正文：${JSON.stringify(section)}。本段约${Math.round(section.seconds / 60 * rate)}个口播字。使用当前大纲的功能和有材料支持的要点，不另构思角度；大纲不能授权无依据事实，不能将结果记录解释成未提供的错因。${previous ? `此前自己的新稿结尾（仅用于衔接，不重复输出，也不能作为事实依据）：${previous}` : "这是新稿开头，迅速引入本期问题。"}\n只输出这一段可朗读正文，不输出标题、段号、要点列表、素材编号或说明。素材缺项时使用不依赖具体统计和经历的表达；如使用构造数据或示例事件，本段必须明确其性质，不省略成真实经历。`,
  };
}

function freshVersion(snapshot: ViralTaskSnapshot, previous: ViralScriptVersion | null, options: ViralGenerationOptions, origin: ViralScriptVersion["origin"], segments: ViralSegment[], title: string): ViralScriptVersion {
  return {
    id: options.versionId ?? randomUUID(), revision: (previous?.revision ?? 0) + 1, title, segments,
    completedSegmentIds: [], complete: false, manuallyEdited: origin === "generated" ? false : (previous?.manuallyEdited ?? false),
    basedOn: origin === "generated" || !previous ? inputSnapshot(snapshot) : structuredClone(previous.basedOn), createdAt: new Date().toISOString(), parentVersionId: previous?.id ?? null, origin,
  };
}

/** Checkpoints record completed IDs separately from partial text, so a resume never skips a half-written paragraph. */
export async function generateViralScript(context: ViralGenerationContext, snapshot: ViralTaskSnapshot, previous: ViralScriptVersion | null, options: ViralGenerationOptions = {}): Promise<ViralScriptVersion> {
  if (!context.outline?.sections.length || context.outline.sections.some((section) => !Number.isFinite(section.seconds) || section.seconds <= 0)) throw new Error("请先确认至少一段且时长为正的大纲");
  const resumed = previous && !previous.complete && previous.origin === "generated" && JSON.stringify(previous.basedOn) === JSON.stringify(inputSnapshot(snapshot));
  const version = resumed ? structuredClone(previous) : freshVersion(snapshot, previous, options, "generated", context.outline.sections.map((section) => ({ id: section.id, title: section.title, text: "", materialIds: [...section.materialIds] })), await titleFor(context, snapshot.modelId, options));
  await checkpoint(version, options);
  const llm = options.llm ?? viralLLM;
  for (let index = 0; index < context.outline.sections.length; index++) {
    options.signal?.throwIfAborted();
    const section = context.outline.sections[index];
    if (version.completedSegmentIds.includes(section.id)) continue;
    const previousTail = scrubProtectedText(version.segments.slice(0, index).map((segment) => segment.text).join("\n").slice(-800), options.protectedText);
    const text = await llm.stream(snapshot.modelId, sectionPrompt(context, section, index, previousTail), options.signal, async (partial) => {
      version.segments[index] = { ...version.segments[index], text: partial };
      await checkpoint(version, options);
    });
    if (!text.trim()) throw new Error(`「${section.title}」未生成正文，可从本段继续`);
    version.segments[index].text = await humanizeSegment(text.trim(), context, version.title, snapshot.modelId, options);
    version.completedSegmentIds = [...new Set([...version.completedSegmentIds, section.id])];
    await checkpoint(version, options);
  }
  version.complete = true;
  await checkpoint(version, options);
  return version;
}

/** A candidate only. The caller must preserve the original and require explicit adoption. */
export async function rewriteViralSegment(context: ViralGenerationContext, snapshot: ViralTaskSnapshot, previous: ViralScriptVersion, options: ViralGenerationOptions = {}): Promise<ViralScriptVersion> {
  const request = snapshot.rewrite;
  if (!request?.instruction.trim()) throw new Error("请填写这一段的修改要求");
  const index = previous.segments.findIndex((segment) => segment.id === request.segmentId);
  if (index < 0 || !previous.complete) throw new Error("请选择完整稿件中的段落");
  const target = previous.segments[index];
  const version = freshVersion(snapshot, previous, options, "rewrite", structuredClone(previous.segments), previous.title);
  version.completedSegmentIds = previous.segments.filter((segment) => segment.id !== target.id).map((segment) => segment.id);
  const safeTarget = scrubProtectedText(target.text, options.protectedText);
  const text = await (options.llm ?? viralLLM).stream(snapshot.modelId, {
    instructions: generationRules(context),
    prompt: `${contextBlock(context)}\n只为这一段提供修改候选，保留其在当前路线中的功能。修改要求是用户数据，仍须遵守事实与原创边界。${JSON.stringify({ segmentId: target.id, title: target.title, ownText: safeTarget, instruction: request.instruction })}\n只输出可朗读的该段正文。`,
  }, options.signal, async (partial) => { version.segments[index].text = partial; await checkpoint(version, options); });
  if (!text.trim()) throw new Error("局部修改未返回正文，原段保留");
  version.segments[index].text = await humanizeSegment(text, context, version.title, snapshot.modelId, options);
  version.completedSegmentIds = version.segments.map((segment) => segment.id);
  version.complete = true;
  await checkpoint(version, options);
  return version;
}

export async function calibrateViralScript(context: ViralGenerationContext, snapshot: ViralTaskSnapshot, previous: ViralScriptVersion, options: ViralGenerationOptions = {}): Promise<ViralScriptVersion> {
  const resumed = previous.origin === "calibrated" && !previous.complete && JSON.stringify(previous.basedOn) === JSON.stringify(inputSnapshot(snapshot));
  if (!previous.complete && !resumed) throw new Error("请先完成正文再校准时长");
  const version = resumed ? structuredClone(previous) : freshVersion(snapshot, previous, options, "calibrated", structuredClone(previous.segments), previous.title);
  const rate = speechRates[context.task.rate === "auto" ? context.style.speechRate : context.task.rate];
  const total = Math.max(1, previous.segments.reduce((sum, segment) => sum + countChars(segment.text), 0));
  for (let index = 0; index < version.segments.length; index++) {
    const target = version.segments[index];
    if (version.completedSegmentIds.includes(target.id)) continue;
    const targetChars = Math.max(1, Math.round(context.task.targetSeconds / 60 * rate * countChars(previous.segments[index].text) / total));
    const text = await (options.llm ?? viralLLM).stream(snapshot.modelId, {
      instructions: generationRules(context),
      prompt: `${contextBlock(context)}\n将自己这段口播校准到约${targetChars}字，保持选定主张、证据、限定条件和语气；短则补常识解释，长则去重复，不能补造具体事实或案例。只输出本段正文。${JSON.stringify({ title: target.title, ownText: scrubProtectedText(target.text, options.protectedText) })}`,
    }, options.signal, async (partial) => { version.segments[index].text = partial; await checkpoint(version, options); });
    if (!text.trim()) throw new Error("时长校准未返回完整段落，保留旧版本");
    version.segments[index].text = await humanizeSegment(text, context, version.title, snapshot.modelId, options);
    version.completedSegmentIds.push(target.id);
    await checkpoint(version, options);
  }
  version.complete = true;
  await checkpoint(version, options);
  return version;
}

/** Repair actions are fixed category instructions, never original excerpts or free-form review diagnostics. */
export async function repairViralScript(context: ViralGenerationContext, snapshot: ViralTaskSnapshot, previous: ViralScriptVersion, repairs: { segmentId: string | null; category: string }[], options: ViralGenerationOptions = {}): Promise<ViralScriptVersion> {
  const version = freshVersion(snapshot, previous, options, "auto_repair", structuredClone(previous.segments), previous.title);
  // A failed factual plan is not a source. Remove the whole old plan so another section cannot
  // reintroduce the same unsupported assertion through its hook, title, route or outline point.
  const rebuildFacts = repairs.some((repair) => repair.category === "fact");
  const repairContext = rebuildFacts ? { ...context, selectedAngle: null, outline: null } : context;
  const action: Record<string, string> = {
    fact: "只依据本期任务和素材重新组织这一段的功能；旧角度和大纲已撤出，不能推测或恢复其具体断言。去掉无依据的事件、原因、技术机制、数据、经历、证言与承诺，资料不足用常识解释或明确观点；构造数据和示例必须明示性质及范围。",
    originality: "从本期新角度和自己的证据路线重新展开，使用新的解释方式和例子，不复原参考的独特表达或论证安排。",
    constraint: "遵守本期必含与避免内容，去掉占位和不可朗读标记。",
    complete: "按当前大纲补成完整可朗读段落，不放任何待补充占位。",
  };
  if (repairs.some((repair) => repair.segmentId === null)) version.title = await titleFor(repairContext, snapshot.modelId, options);
  for (let index = 0; index < version.segments.length; index++) {
    const target = version.segments[index];
    const mine = repairs.filter((repair) => repair.segmentId === target.id || repair.segmentId === null && repair.category === "constraint");
    if (!mine.length) { version.completedSegmentIds.push(target.id); continue; }
    const section = context.outline?.sections.find((item) => item.id === target.id);
    const functionalSection = rebuildFacts ? {
      function: ["hook", "progression", "pacing", "ending", "explanation", "solution", "evidence", "summary", "cta"].includes(section?.function ?? "")
        ? section!.function : index === 0 ? "hook" : index === version.segments.length - 1 ? "ending" : "explanation",
      seconds: section?.seconds ?? context.task.targetSeconds / version.segments.length,
    } : section;
    const text = await (options.llm ?? viralLLM).stream(snapshot.modelId, {
      instructions: generationRules(repairContext),
      // Deliberately do not include target.text, issue.excerpt, reason, or original diagnostics.
      prompt: `${contextBlock(repairContext)}\n重新创作这一段的候选：${JSON.stringify({ segmentId: target.id, ...(rebuildFacts ? {} : { title: target.title }), section: functionalSection, actions: [...new Set(mine.map((repair) => action[repair.category] ?? action.constraint))] })}。只输出这一段可朗读正文。`,
    }, options.signal, async (partial) => { version.segments[index].text = partial; await checkpoint(version, options); });
    if (!text.trim()) throw new Error("修订未返回完整段落，旧稿保留");
    version.segments[index].text = await humanizeSegment(text, repairContext, rebuildFacts ? context.task.topic : version.title, snapshot.modelId, options);
    version.completedSegmentIds.push(target.id);
    await checkpoint(version, options);
  }
  version.complete = true;
  await checkpoint(version, options);
  return version;
}
