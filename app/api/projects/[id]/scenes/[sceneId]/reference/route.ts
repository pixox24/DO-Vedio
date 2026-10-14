import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { sceneSourceHash } from "@/lib/core/scenes";
import { resolveImageModel } from "@/lib/pipeline/image-models";
import { get } from "@/lib/server/db";
import { enqueue } from "@/lib/server/jobs";
import { ensureProjectVisualStyle } from "@/lib/visual-styles/store";

const body = z.object({ modelId: z.string().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string; sceneId: string }> }) {
  return handle(async () => {
    const { id, sceneId } = await ctx.params;
    const input = await parseBody(req, body);
    const project = await ensureProjectVisualStyle(id);
    if (!project) return fail("项目不存在", 404);
    const scene = project.doc.scenes.find((card) => card.id === sceneId);
    if (!scene) return fail("场景不存在", 404);
    if (scene.locked) return fail("场景已锁定，请先解锁", 409);
    if (!scene.description.trim()) return fail("请先填写空间陈设描述", 409);
    const modelId = resolveImageModel(input.modelId);
    if (!modelId) return fail("没有可用的图片模型，请在模型中心配置并启用", 409);
    const busy = get<{ id: string }>("SELECT id FROM jobs WHERE project_id = ? AND stage = 'scene-reference' AND status IN ('queued', 'running') AND json_extract(input, '$.sceneId') = ? LIMIT 1", id, sceneId);
    if (busy) return fail("这个场景正在生成，请等当前任务完成", 409);
    const job = enqueue({ projectId: id, stage: "scene-reference", key: `scene-reference:${id}:${sceneId}:${sceneSourceHash(scene, project.doc.visualStyle)}:${Date.now()}`, target: `场景图 ${scene.name}`, input: { projectId: id, sceneId, modelId }, priority: 6 });
    return Response.json({ job });
  });
}
