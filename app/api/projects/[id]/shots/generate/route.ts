import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { shotGenerationKey } from "@/lib/core/keys";
import { listProviderProfiles } from "@/lib/providers/registry";
import { enqueue } from "@/lib/server/jobs";
import { getProject } from "@/lib/server/projects";
import { assetStale, needsGeneratedImage } from "@/lib/core/prompt-compiler";
import { ensureProjectVisualStyle } from "@/lib/visual-styles/store";

const body = z.object({ modelId: z.string().min(1), candidateCount: z.number().int().min(1).max(4).default(1) });

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/shots/generate">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const project = (await ensureProjectVisualStyle(id)) ?? getProject(id);
    if (!project) return fail("项目不存在", 404);
    const input = await parseBody(req, body);
    const model = listProviderProfiles().find((p) => p.kind === "image" && p.configured && p.enabled && `${p.providerId}::${p.modelId}` === input.modelId);
    if (!model) return fail("图片模型不可用，请在模型中心检查配置", 409);
    const selectedId = model.custom ? input.modelId : model.modelId;
    // 缺素材或素材已过期（描述、景别、风格改过）的生成画面镜头；信息卡、标题卡、金句卡不生图
    const shots = project.doc.shots.filter((shot) => !shot.locked && needsGeneratedImage(shot) && (!shot.assetId || assetStale(project.doc, shot)));
    if (!shots.length) return fail("没有需要生成图片的镜头", 409);
    const jobs = shots.map((shot) => enqueue({
      projectId: id,
      stage: "shot-generate",
      key: shotGenerationKey(project.doc, shot, "image", selectedId),
      target: `镜头 ${shot.id}`,
      input: { projectId: id, shotId: shot.id, kind: "image", modelId: selectedId, candidateCount: input.candidateCount },
      priority: 6,
    }));
    return Response.json({ count: jobs.length, jobs });
  });
}
