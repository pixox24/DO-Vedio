import { subtitleTranslateUnits } from "../../core/subtitle/translate-plan";
import { mergeSecondaryResults } from "../../core/subtitle/merge";
import { beginGenerationRun, failGenerationRun, finishGenerationRun, type GenerationRunHandle } from "../../providers/runs";
import { getProject, mutateProject } from "../../server/projects";
import { estimateLlmCost } from "../pricing";
import { translateSubtitleUnits } from "../subtitle-translate";
import { defineStage, PermanentError } from "../stage";

/** 双语开着时，把还没对上的口播译成副行。关着则什么都不调用。 */

export type SubtitleTranslateInput = { projectId: string; modelId: string };

export const subtitleTranslateStage = defineStage<SubtitleTranslateInput, { translated: number }>({
  name: "subtitle-translate",
  concurrency: 1,
  async run(input, ctx) {
    const project = getProject(input.projectId);
    if (!project) throw new PermanentError("项目不存在");
    if (!project.doc.settings.subtitle.bilingual) return { translated: 0 };
    const units = subtitleTranslateUnits(project.doc.lines);
    if (units.length === 0) return { translated: 0 };

    ctx.progress(0.05, `翻译 ${units.length} 句`);
    const providerId = input.modelId === "claude" ? "anthropic" : input.modelId;
    const generation = beginGenerationRun({
      projectId: input.projectId,
      jobId: ctx.job.id,
      providerId,
      modelId: input.modelId,
      kind: "text",
      inputHash: ctx.job.key,
      params: { stage: "subtitle-translate", lineCount: units.length },
    });
    let settled = false;
    const settle = (handle: GenerationRunHandle, status: "succeeded" | "failed" | "canceled", costYuan: number, ledgerId: number | undefined, error?: string) => {
      settled = true;
      finishGenerationRun(handle.id, { status, latencyMs: Date.now() - handle.startedAt, costYuan, ledgerId, error });
    };
    try {
      const result = await translateSubtitleUnits(input.modelId, units, {
        signal: ctx.signal,
        onProgress: (done, total) => ctx.progress(total ? done / total : 1, `翻译 ${done}/${total} 句`),
      });
      if (!ctx.current()) throw ctx.signal.reason ?? new DOMException("任务已取消", "AbortError");
      if (result.items.length > 0) {
        mutateProject(input.projectId, (doc) => {
          if (!ctx.current()) return null;
          return { ...doc, lines: mergeSecondaryResults(doc.lines, result.items) };
        });
      }
      const costYuan = estimateLlmCost(input.modelId, result.inputChars, result.outputChars);
      const ledgerId = costYuan > 0 || result.inputChars > 0 ? ctx.spend({ provider: providerId, model: input.modelId, unit: "call", quantity: 1, costYuan }) : undefined;
      const latest = getProject(input.projectId);
      const aborted = result.aborted || ctx.signal.aborted;
      if (aborted) {
        settle(generation, "canceled", costYuan, ledgerId);
        throw ctx.signal.reason ?? new DOMException("任务已取消", "AbortError");
      }
      const remaining = latest?.doc.settings.subtitle.bilingual ? subtitleTranslateUnits(latest.doc.lines) : [];
      if (remaining.length > 0) {
        const reason = result.failed[0]?.reason;
        const message = reason ? `还有 ${remaining.length} 句没有翻译：${reason}` : `还有 ${remaining.length} 句没有翻译`;
        settle(generation, "failed", costYuan, ledgerId, message);
        throw new Error(message);
      }
      settle(generation, "succeeded", costYuan, ledgerId);
      return { translated: result.items.length };
    } catch (error) {
      if (!settled) failGenerationRun(generation, error, ctx.signal.aborted || (error instanceof Error && error.name === "AbortError"));
      throw error;
    }
  },
});
