import { quickHash } from "../../core/hash";
import { compilePrompt } from "../../core/prompt-compiler";
import type { ShotSize, VisualStyleInput } from "../../core/types";
import { beginGenerationRun, failGenerationRun, finishGenerationRun } from "../../providers/runs";
import { cacheGet, cachePut } from "../../server/cache";
import { defaultGenerationFrame, generateBatch, generateMediaAssets, mediaProviderId } from "../media-gen";
import { defineStage } from "../stage";

/**
 * 风格样张：用固定的 3 个测试场景生成样张，方便不同风格横向对比。
 * 缓存键 = 编译后的提示词 + 模型，风格卡没改就不重复花钱。
 */

export const PREVIEW_SCENES: { name: string; content: string; shotSize: ShotSize }[] = [
  { name: "人物中景", content: "一位中年人坐在窗边的旧沙发上低头看书，身旁小桌上放着一杯热茶", shotSize: "medium" },
  { name: "城市全景", content: "清晨的城市街道，零星的行人和自行车，远处是高楼和薄雾", shotSize: "wide" },
  { name: "静物特写", content: "木桌上的一杯咖啡和一本摊开的笔记本，旁边放着一支钢笔", shotSize: "close" },
];

export function previewPrompts(style: VisualStyleInput) {
  return PREVIEW_SCENES.map((scene) => compilePrompt({ content: scene.content, shotSize: scene.shotSize, style: { ...style, id: "preview" } }));
}

export function stylePreviewKey(style: VisualStyleInput, modelId: string) {
  return `style-preview:${quickHash({ v: 1, prompts: previewPrompts(style).map((p) => p.hash), modelId })}`;
}

/** 已生成的样张：与场景一一对应 */
export type StylePreview = { assets: string[] };
export const getStylePreview = (style: VisualStyleInput, modelId: string) => cacheGet<StylePreview>(stylePreviewKey(style, modelId));

export type StylePreviewInput = { style: VisualStyleInput; modelId: string };

export const stylePreviewStage = defineStage<StylePreviewInput, StylePreview>({
  name: "style-preview",
  concurrency: 4,
  async run(input, ctx) {
    const key = stylePreviewKey(input.style, input.modelId);
    const cached = cacheGet<StylePreview>(key);
    if (cached) return cached;
    const prompts = previewPrompts(input.style);
    const assets = await generateBatch(prompts, {
      itemKey: (k) => `${key}:${k}`,
      signal: ctx.signal,
      current: ctx.current,
      onProgress: (done, total) => ctx.progress(done / total, `样张 ${done}/${total}`),
      run: async (prompt, k) => {
        const run = beginGenerationRun({ jobId: ctx.job.id, providerId: mediaProviderId("image", input.modelId), modelId: input.modelId, kind: "image", inputHash: `${key}:${k}`, params: { stage: "style-preview", style: input.style.name, scene: PREVIEW_SCENES[k].name, prompt: prompt.full, frame: defaultGenerationFrame } });
        try {
          const { assets: [asset] } = await generateMediaAssets({ kind: "image", modelId: input.modelId, prompt: prompt.full, frame: defaultGenerationFrame, meta: { stylePreview: input.style.name, scene: PREVIEW_SCENES[k].name } }, ctx.signal);
          finishGenerationRun(run.id, { status: "succeeded", latencyMs: Date.now() - run.startedAt, outputAssets: [asset] });
          return asset;
        } catch (e) {
          failGenerationRun(run, e, ctx.signal.aborted);
          throw e;
        }
      },
    });
    if (!ctx.current()) throw ctx.signal.reason ?? new DOMException("样张任务已取消", "AbortError");
    const result = { assets };
    cachePut(key, "style-preview", result);
    ctx.progress(1, "样张已生成");
    return result;
  },
});
