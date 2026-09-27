import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { visualStyleInputSchema } from "@/lib/core/types";
import { getStylePreview, stylePreviewKey } from "@/lib/pipeline/stages/style-preview";
import { resolveImageModel } from "@/lib/pipeline/image-models";
import { enqueue, latestJobByKey } from "@/lib/server/jobs";

const body = z.object({ style: visualStyleInputSchema, modelId: z.string().optional(), generate: z.boolean().default(false) });

/**
 * 风格样张：已生成过就直接返回；generate=true 时提交生成任务（会产生费用）。
 * 前端轮询任务结束后再调用一次拿结果。
 */
export async function POST(req: Request) {
  return handle(async () => {
    const input = await parseBody(req, body);
    const modelId = resolveImageModel(input.modelId);
    if (!modelId) return fail("没有可用的图片模型，请在模型中心配置并启用", 409);
    const cached = getStylePreview(input.style, modelId);
    if (cached) return Response.json({ assets: cached.assets });
    const key = stylePreviewKey(input.style, modelId);
    const previous = latestJobByKey(key);
    if (previous && ["queued", "running"].includes(previous.status)) return Response.json({ job: previous });
    if (!input.generate) return Response.json({ assets: null, lastError: previous?.status === "failed" ? previous.error : null });
    const job = enqueue({ projectId: null, stage: "style-preview", key, target: `风格样张 · ${input.style.name}`, input: { style: input.style, modelId }, priority: 5 });
    return Response.json({ job });
  });
}
