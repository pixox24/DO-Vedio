import { z } from "zod";
import { acceptsFreeVoiceInstruction } from "../../core/types";
import { generateJson } from "../../llm";
import { voiceDirectionPrompt } from "../../prompts";
import { beginGenerationRun, failGenerationRun, finishGenerationRun } from "../../providers/runs";
import { cacheGet, cachePut } from "../../server/cache";
import { getProject, mutateProject } from "../../server/projects";
import { estimateLlmCost } from "../pricing";
import { defineStage } from "../stage";
import { sanitizeVoiceInstruction, voiceDirectionKey, voiceDirectionMaterial, type VoiceDirectionCache } from "../voice-direction";

/** 各章标注之后、配音之前：文本框空着且当前是 Qwen-Audio 时，写一句全片说明。失败不挡住配音。 */

export type VoiceDirectionInput = { projectId: string; modelId: string };

const outSchema = z.object({ instruction: z.string() });

export const voiceDirectionStage = defineStage<VoiceDirectionInput, { instruction: string }>({
  name: "voice-direction",
  async run(input, ctx) {
    const project = getProject(input.projectId);
    if (!project) return { instruction: "" };
    const voice = project.doc.settings.voice;
    if (!acceptsFreeVoiceInstruction(voice.model) || voice.instruction.trim()) return { instruction: voice.instruction };
    const key = voiceDirectionKey(project.doc, input.modelId);
    const cached = cacheGet<VoiceDirectionCache>(key);
    let instruction = cached?.instruction || "";
    if (!instruction && cached?.instruction !== null) {
      ctx.progress(0.2, "正在编写");
      const material = voiceDirectionMaterial(project.doc);
      const prompt = voiceDirectionPrompt(material);
      const generation = beginGenerationRun({
        projectId: input.projectId,
        jobId: ctx.job.id,
        providerId: input.modelId === "claude" ? "anthropic" : input.modelId,
        modelId: input.modelId,
        kind: "text",
        inputHash: key,
        params: { stage: "voice-direction" },
      });
      try {
        const raw = await generateJson(input.modelId, outSchema, prompt, ctx.signal);
        if (!ctx.current()) throw ctx.signal.reason ?? new DOMException("任务已取消", "AbortError");
        instruction = sanitizeVoiceInstruction(raw.instruction);
        if (!instruction) throw new Error("全片说明是空的");
        cachePut(key, "voice-direction", { instruction } satisfies VoiceDirectionCache);
        const chars = prompt.instructions.length + prompt.prompt.length;
        const costYuan = estimateLlmCost(input.modelId, chars, instruction.length);
        const ledgerId = ctx.spend({ provider: input.modelId, model: input.modelId, unit: "call", quantity: 1, costYuan });
        finishGenerationRun(generation.id, { status: "succeeded", latencyMs: Date.now() - generation.startedAt, costYuan, ledgerId });
      } catch (error) {
        const canceled = ctx.signal.aborted || (error instanceof Error && error.name === "AbortError");
        failGenerationRun(generation, error, canceled);
        if (canceled) throw error;
        cachePut(key, "voice-direction", { instruction: null } satisfies VoiceDirectionCache);
        return { instruction: "" };
      }
    }
    if (!instruction) return { instruction: "" };
    if (!ctx.current()) throw ctx.signal.reason ?? new DOMException("任务已取消", "AbortError");
    mutateProject(input.projectId, (doc) => {
      if (!ctx.current()) return null;
      const current = doc.settings.voice;
      if (!acceptsFreeVoiceInstruction(current.model) || current.instruction.trim()) return null;
      return { ...doc, settings: { ...doc.settings, voice: { ...current, instruction, instructionSource: "generated" } } };
    });
    return { instruction };
  },
});
