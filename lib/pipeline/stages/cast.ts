import { randomUUID } from "crypto";
import { castDraftSchema, castIssues, castSourceHash, decideCharacters, reconcileCharacters, type CastDraft } from "../../core/cast";
import { castKey } from "../../core/keys";
import { generateJson } from "../../llm";
import { castPrompt, type CastPayload } from "../../prompts";
import { beginGenerationRun, failGenerationRun, finishGenerationRun } from "../../providers/runs";
import { cacheGet, cachePut } from "../../server/cache";
import { getProject, mutateProject } from "../../server/projects";
import { getTemplate } from "../../templates/store";
import { estimateLlmCost } from "../pricing";
import { defineStage, PermanentError } from "../stage";

/**
 * 选角：全片一次大模型调用。识别叙事模式和全部人物（指代归并），
 * 规则决定谁建卡，再与已有角色卡对账（锁定的卡和用户改过的字段不动）。
 */

/** force：跳过缓存重新调用大模型（用户手动「重新识别」） */
export type CastInput = { projectId: string; modelId: string; force?: boolean };

export const castStage = defineStage<CastInput, { characters: number; skipped: number }>({
  name: "cast",
  concurrency: 2,
  async run(input, ctx) {
    const project = getProject(input.projectId);
    if (!project) throw new PermanentError("项目不存在");
    const doc = project.doc;
    const sourceHash = castSourceHash(doc);
    const template = await getTemplate(doc.brief.templateId).catch(() => undefined);
    const payload: CastPayload = {
      title: doc.brief.title,
      brief: { summary: doc.brief.summary, perspective: doc.brief.perspective },
      style: template && { name: template.name, description: template.description },
      segments: doc.segments.map((s, index) => ({ index, title: s.title })),
      lines: doc.lines.map((l) => ({ id: l.id, segmentIndex: l.segmentIndex, text: l.text })),
    };
    const key = castKey({ payload, modelId: input.modelId });
    let draft = input.force ? undefined : cacheGet<CastDraft>(key);
    if (!draft) {
      ctx.progress(0.1, "大模型分析角色中");
      const prompt = castPrompt(payload);
      const generation = beginGenerationRun({ projectId: input.projectId, jobId: ctx.job.id, providerId: input.modelId === "claude" ? "anthropic" : input.modelId, modelId: input.modelId, kind: "text", inputHash: key, params: { stage: "cast", lineCount: doc.lines.length } });
      try {
        draft = await generateJson(input.modelId, castDraftSchema, prompt);
        cachePut(key, "cast", draft);
        const costYuan = estimateLlmCost(input.modelId, prompt.instructions.length + prompt.prompt.length, JSON.stringify(draft).length);
        const ledgerId = ctx.spend({ provider: input.modelId, model: input.modelId, unit: "call", quantity: 1, costYuan });
        finishGenerationRun(generation.id, { status: "succeeded", latencyMs: Date.now() - generation.startedAt, costYuan, ledgerId });
      } catch (e) {
        failGenerationRun(generation, e, ctx.signal.aborted);
        throw e;
      }
    }
    const { cards, skipped } = decideCharacters(draft, doc.lines);
    let count = 0;
    mutateProject(input.projectId, (cur) => {
      const characters = reconcileCharacters(cur.characters, cards, () => randomUUID());
      count = characters.filter((c) => !c.absent).length;
      const segments = new Set(cur.lines.map((l) => l.segmentIndex));
      return {
        ...cur,
        characters,
        // 记下分析时的文案指纹；期间文案又改了，编排层下次会发现不一致并重跑
        castAnalysis: { sourceHash, modes: draft!.modes.filter((m) => segments.has(m.segmentIndex)), skipped, issues: castIssues(characters) },
      };
    });
    ctx.progress(1, `识别到 ${count} 个角色`);
    return { characters: count, skipped: skipped.length };
  },
});
