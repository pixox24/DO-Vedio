import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { isAiVideo, missingVideoStandards, sourceImageSnapshot, sourceImageStale } from "@/lib/core/video";
import { getProject, mutateProject } from "@/lib/server/projects";
import { enqueueShotReference, videoFrame } from "@/lib/pipeline/video-generation";
import { wakeCurrentGoal } from "@/lib/pipeline/plan";
import { resolveImageModel } from "@/lib/pipeline/image-models";
import { listProviderProfiles } from "@/lib/providers/registry";
import { PermanentError } from "@/lib/pipeline/stage";
import { videoPlanNeedsSync } from "@/lib/core/video-plan";

const body = z.object({ modelId: z.string().optional(), outputSpecId: z.enum(["landscape-1080p", "portrait-1080p"]).optional() }).strict();
export async function POST(req: Request, ctx: { params: Promise<{ id: string; shotId: string }> }) {
  return handle(async () => {
    const { id, shotId } = await ctx.params;
    const input = await parseBody(req, body);
    let project = getProject(id);
    let shot = project?.doc.shots.find((item) => item.id === shotId);
    if (!project || !shot) return fail("镜头不存在", 404);
    if (!isAiVideo(project.doc.settings.visualPipeline) || shot.kind !== "video" || !shot.videoPlan) return fail("请先重新导演生成视频分镜", 409);
    if (shot.locked) return fail("镜头已锁定，请先解锁", 409);
    if (videoPlanNeedsSync(shot)) return fail("等待中文镜头要求同步到执行计划", 409);
    if (missingVideoStandards(project.doc, shot).length) return fail("请先在角色和场景中补齐并采用有效标准图", 409);
    const resolved = resolveImageModel(input.modelId || project.doc.settings.video.referenceImageModelId || undefined);
    if (!resolved) return fail("参考图模型不可用，请在模型中心检查配置", 409);
    const profile = listProviderProfiles().find((model) => model.kind === "image" && (resolved === model.modelId || resolved === `${model.providerId}::${model.modelId}`));
    const canonical = profile ? `${profile.providerId}::${profile.modelId}` : resolved;
    if (canonical !== project.doc.settings.video.referenceImageModelId) project = mutateProject(id, (doc) => ({ ...doc, settings: { ...doc.settings, video: { ...doc.settings.video, referenceImageModelId: canonical } } }))!;
    shot = project.doc.shots.find((item) => item.id === shotId)!;
    try {
      const job = enqueueShotReference(id, project.doc, shot, videoFrame(project.doc), canonical);
      return Response.json({ job, shot, snapshotHash: sourceImageSnapshot(project.doc, shot, videoFrame(project.doc)).hash });
    } catch (error) { if (error instanceof PermanentError) return fail(error.message, 409); throw error; }
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; shotId: string }> }) {
  return handle(async () => {
    const { id, shotId } = await ctx.params;
    const { confirmHash } = await parseBody(req, z.object({ confirmHash: z.string().min(1) }));
    let matched = false;
    const project = mutateProject(id, (doc) => {
      const shot = doc.shots.find((item) => item.id === shotId);
      if (!shot || shot.locked || !isAiVideo(doc.settings.visualPipeline) || !shot.sourceImageAssetId || videoPlanNeedsSync(shot) || missingVideoStandards(doc, shot).length) return null;
      const snapshot = sourceImageSnapshot(doc, shot, videoFrame(doc));
      if (snapshot.hash !== confirmHash || sourceImageStale(doc, shot, videoFrame(doc))) return null;
      matched = true;
      return { ...doc, shots: doc.shots.map((item) => item.id === shotId ? { ...item, sourceImageConfirmedHash: snapshot.hash } : item) };
    });
    if (!project) return fail("项目不存在", 404);
    if (!matched) return fail("参考图已变化或镜头已锁定，请刷新后重新确认", 409);
    wakeCurrentGoal(id);
    return Response.json({ shot: project.doc.shots.find((item) => item.id === shotId), snapshotHash: confirmHash });
  });
}
