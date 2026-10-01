import { outputSpecForRequest } from "../../core/output-spec";
import type { Aspect, OutputSpecId } from "../../core/types";
import { animationHash, contentHash, timelineHash } from "../../core/timeline";
import { getProject } from "../../server/projects";
import { timelineFor } from "../artifacts";
import { renderTimeline, type Quality, type RenderOutput } from "../render";
import { defineStage, PermanentError } from "../stage";
import { beginGenerationRun, failGenerationRun, finishGenerationRun } from "../../providers/runs";

/**
 * 渲染一个画幅。执行时按最新文档重建时间轴（用户排队期间又改了东西也没关系），
 * 结果记录实际渲染的时间轴哈希。
 */
export type RenderInput = { projectId: string; aspect?: Aspect; outputSpecId?: OutputSpecId; quality: Quality };

export const renderStage = defineStage<RenderInput, RenderOutput & { timelineHash: string; contentHash: string; animationHash: string }>({
  name: "render",
  concurrency: 1,
  async run(input, ctx) {
    const p = getProject(input.projectId);
    if (!p) throw new PermanentError("项目不存在");
    const spec = outputSpecForRequest(p.doc.settings, input.outputSpecId, input.aspect);
    const t = timelineFor(p.doc, input.projectId, spec.id);
    if (t.voice.length === 0) throw new PermanentError("还没有任何配音，无法渲染");
    const hash = timelineHash(t);
    const content = contentHash(t);
    const animation = animationHash(t);
    const generation = beginGenerationRun({ projectId: input.projectId, jobId: ctx.job.id, providerId: "internal", modelId: "remotion-renderer", kind: "video", inputHash: content, params: { stage: "render", outputSpecId: spec.id, aspect: spec.aspect, width: spec.width, height: spec.height, fps: spec.fps, quality: input.quality, animationHash: animation } });
    let out;
    try {
      out = await renderTimeline({ projectId: input.projectId, timeline: t, timelineHash: hash, contentHash: content, animationHash: animation, quality: input.quality, signal: ctx.signal, current: ctx.current, progress: ctx.progress });
    } catch (e) {
      failGenerationRun(generation, e, ctx.signal.aborted);
      throw e;
    }
    finishGenerationRun(generation.id, { status: "succeeded", latencyMs: Date.now() - generation.startedAt, outputAssets: [out.videoHash, ...(out.srtHash ? [out.srtHash] : [])] });
    return { ...out, timelineHash: hash, contentHash: content, animationHash: animation };
  },
});
