import { randomUUID } from "crypto";
import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { shotGenerationKey } from "@/lib/core/keys";
import { getProject, mutateProject } from "@/lib/server/projects";
import { enqueue, latestJobByKey } from "@/lib/server/jobs";
import { listProviderProfiles } from "@/lib/providers/registry";
import { ensureProjectVisualStyle } from "@/lib/visual-styles/store";
import { outputSpecForRequest, outputSpecsFor, previewSpecFor, type GenerationFrame } from "@/lib/core/output-spec";
import { selectShotCandidate } from "@/lib/core/shot-asset";
import type { Aspect, OutputSpecId } from "@/lib/core/types";
import { enqueueAutoPortraits, enqueueAutoScenes } from "@/lib/pipeline/auto-portrait";

const body = z.object({ kind: z.enum(["image", "video"]), modelId: z.string().optional(), candidateCount: z.number().int().min(1).max(4).optional(), outputSpecId: z.enum(["landscape-1080p", "portrait-1080p"]).optional(), aspect: z.enum(["16:9", "9:16"]).optional(), assetFraming: z.enum(["smart-dual", "per-output", "shared"]).optional() });

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
    const spec = outputSpecForRequest(project.doc.settings, input.outputSpecId as OutputSpecId | undefined, input.aspect as Aspect | undefined);
    const frame: GenerationFrame = { aspect: spec.aspect, width: spec.width, height: spec.height, fps: spec.fps };
    const key = shotGenerationKey(project.doc, shot, input.kind, selectedId, frame);
    const previous = latestJobByKey(key, id);
    if (previous && ["queued", "running"].includes(previous.status)) return Response.json({ job: previous, reused: true });
    enqueueAutoPortraits(id);
    enqueueAutoScenes(id);
    const job = enqueue({ projectId: id, stage: "shot-generate", key, target: `镜头 ${shotId}`, input: { projectId: id, shotId, kind: input.kind, modelId: selectedId, candidateCount: input.candidateCount ?? 1, outputSpecId: spec.id, frame, assetFraming: input.assetFraming ?? project.doc.settings.assetFraming, batchId: randomUUID() }, priority: 6 });
    return Response.json({ job, model: { providerId: model.providerId, modelId: model.modelId } });
  });
}

const selectBody = z.object({ candidateId: z.string().min(1), aspect: z.enum(["16:9", "9:16"]).optional() });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; shotId: string }> }) {
  return handle(async () => {
    const { id, shotId } = await ctx.params;
    if (!getProject(id)) return fail("项目不存在", 404);
    const { candidateId, aspect } = await parseBody(req, selectBody);
    let selected = false;
    const project = mutateProject(id, (doc) => {
      const shot = doc.shots.find((s) => s.id === shotId);
      if (!shot) return null;
      const next = selectShotCandidate(shot, candidateId, {
        aspect: aspect ?? previewSpecFor(doc.settings).aspect,
        framing: doc.settings.assetFraming,
        aspects: outputSpecsFor(doc.settings).map((spec) => spec.aspect),
      });
      if (!next) return null;
      selected = true;
      return { ...doc, shots: doc.shots.map((s) => (s.id === shotId ? next : s)) };
    });
    if (!project || !selected) return fail("候选素材不存在", 404);
    return Response.json({ shot: project.doc.shots.find((s) => s.id === shotId) });
  });
}
