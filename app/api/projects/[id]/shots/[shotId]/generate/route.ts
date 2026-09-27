import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { shotGenerationKey } from "@/lib/core/keys";
import { getProject, mutateProject } from "@/lib/server/projects";
import { enqueue, latestJobByKey } from "@/lib/server/jobs";
import { listProviderProfiles } from "@/lib/providers/registry";
import { ensureProjectVisualStyle } from "@/lib/visual-styles/store";

const body = z.object({ kind: z.enum(["image", "video"]), modelId: z.string().optional(), candidateCount: z.number().int().min(1).max(4).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string; shotId: string }> }) {
  return handle(async () => {
    const { id, shotId } = await ctx.params;
    // 确认点：没选风格时先写入推荐风格，缓存键和生成都以它为准
    const project = (await ensureProjectVisualStyle(id)) ?? getProject(id);
    if (!project) return fail("项目不存在", 404);
    const shot = project.doc.shots.find((s) => s.id === shotId);
    if (!shot) return fail("镜头不存在", 404);
    if (shot.locked) return fail("镜头已锁定，请先解锁", 409);
    const input = await parseBody(req, body);
    const models = listProviderProfiles().filter((p) => p.kind === input.kind && p.adapterStatus === "ready" && p.configured && p.enabled);
    const model = input.modelId ? models.find((p) => `${p.providerId}::${p.modelId}` === input.modelId) : models[0];
    if (!model) return fail("没有可用的图片模型，请在模型中心配置并启用", 409);
    const selectedId = model.custom ? `${model.providerId}::${model.modelId}` : model.modelId;
    const key = shotGenerationKey(project.doc, shot, input.kind, selectedId);
    const previous = latestJobByKey(key);
    if (previous && ["queued", "running"].includes(previous.status)) return Response.json({ job: previous, reused: true });
    const job = enqueue({ projectId: id, stage: "shot-generate", key, target: `镜头 ${shotId}`, input: { projectId: id, shotId, kind: input.kind, modelId: selectedId, candidateCount: input.candidateCount ?? 1 }, priority: 6 });
    return Response.json({ job, model: { providerId: model.providerId, modelId: model.modelId } });
  });
}

const selectBody = z.object({ candidateId: z.string().min(1) });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; shotId: string }> }) {
  return handle(async () => {
    const { id, shotId } = await ctx.params;
    if (!getProject(id)) return fail("项目不存在", 404);
    const { candidateId } = await parseBody(req, selectBody);
    let selected = false;
    const project = mutateProject(id, (doc) => {
      const shot = doc.shots.find((s) => s.id === shotId);
      if (!shot) return null;
      if (!shot.candidates.some((c) => c.id === candidateId)) return null;
      selected = true;
      return { ...doc, shots: doc.shots.map((s) => s.id === shotId ? { ...s, assetId: s.candidates.find((c) => c.id === candidateId)!.assetId, candidates: s.candidates.map((c) => ({ ...c, selected: c.id === candidateId })) } : s) };
    });
    if (!project || !selected) return fail("候选素材不存在", 404);
    return Response.json({ shot: project.doc.shots.find((s) => s.id === shotId) });
  });
}
