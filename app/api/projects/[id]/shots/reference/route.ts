import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { missingVideoStandards, sourceImageSnapshot, sourceImageStale } from "@/lib/core/video";
import { videoPlanNeedsSync } from "@/lib/core/video-plan";
import { getProject, mutateProject } from "@/lib/server/projects";
import { projectJobs } from "@/lib/server/jobs";
import { enqueueShotReference, videoFrame } from "@/lib/pipeline/video-generation";
import { resolveImageModel } from "@/lib/pipeline/image-models";
import { getGoal, wakeCurrentGoal } from "@/lib/pipeline/plan";
import { PermanentError } from "@/lib/pipeline/stage";

type Context = { params: Promise<{ id: string }> };
const shotIdsSchema = z.array(z.string().min(1)).min(1).max(500).refine((ids) => new Set(ids).size === ids.length, "镜头不能重复");
const generateBody = z.object({ shotIds: shotIdsSchema, operation: z.enum(["generate", "retry"]).default("generate") }).strict();
const confirmBody = z.object({ references: z.array(z.object({ shotId: z.string().min(1), confirmHash: z.string().min(1) }).strict()).min(1).max(500)
  .refine((items) => new Set(items.map((item) => item.shotId)).size === items.length, "镜头不能重复") }).strict();

/** 重做标记的镜头参考图；所有镜头与项目模型先校验，再提交任何任务。 */
export async function POST(req: Request, ctx: Context) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { shotIds, operation } = await parseBody(req, generateBody);
    const project = getProject(id);
    if (!project) return fail("项目不存在", 404);
    const doc = project.doc;
    if (doc.settings.visualPipeline !== "video") return fail("请先切换到 AI 视频驱动", 409);
    const modelId = doc.settings.video.referenceImageModelId;
    if (!modelId || !resolveImageModel(modelId)) return fail("请先在制作设置中保存可用的参考图模型", 409);
    const shots = shotIds.map((shotId) => doc.shots.find((shot) => shot.id === shotId));
    if (shots.some((shot) => !shot || shot.kind !== "video" || !shot.videoPlan || shot.locked || videoPlanNeedsSync(shot))) {
      return fail("部分镜头不存在、已锁定或执行计划尚未同步，请刷新后重试", 409);
    }
    try {
      const frame = videoFrame(doc);
      const eligible = shots.filter((shot) => !missingVideoStandards(doc, shot!).length);
      if (!eligible.length) return fail("请先在角色和场景中补齐并采用有效标准图", 409);
      // A result may have arrived while the user was confirming the retry.
      const targets = operation === "retry" ? eligible.filter((shot) => !shot!.sourceImageAssetId || sourceImageStale(doc, shot!, frame)) : eligible;
      const jobs = targets.map((shot) => enqueueShotReference(id, doc, shot!, frame, modelId));
      return Response.json({ count: jobs.length, skipped: shots.length - targets.length, jobs });
    } catch (error) { if (error instanceof PermanentError) return fail(error.message, 409); throw error; }
  });
}

/** 整批原子确认：任一画面变化或仍在重做，整批保留原状态。 */
export async function PATCH(req: Request, ctx: Context) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { references } = await parseBody(req, confirmBody);
    let matched = false;
    const project = mutateProject(id, (doc) => {
      if (doc.settings.visualPipeline !== "video") return null;
      const frame = videoFrame(doc);
      const active = new Set(projectJobs(id).filter((job) => job.stage === "shot-reference" && ["queued", "running"].includes(job.status))
        .map((job) => (job.input as { shotId?: string } | null)?.shotId));
      for (const { shotId, confirmHash } of references) {
        const shot = doc.shots.find((item) => item.id === shotId);
        if (!shot || shot.kind !== "video" || !shot.videoPlan || shot.locked || videoPlanNeedsSync(shot) || !shot.sourceImageAssetId
          || missingVideoStandards(doc, shot).length || active.has(shotId) || sourceImageStale(doc, shot, frame) || sourceImageSnapshot(doc, shot, frame).hash !== confirmHash) return null;
      }
      const hashes = new Map(references.map(({ shotId, confirmHash }) => [shotId, confirmHash]));
      matched = true;
      return { ...doc, shots: doc.shots.map((shot) => hashes.has(shot.id) ? { ...shot, sourceImageConfirmedHash: hashes.get(shot.id) } : shot) };
    });
    if (!project) return fail("项目不存在", 404);
    if (!matched) return fail("部分参考图已变化、正在重做或镜头尚不可确认，请刷新后整批重试", 409);
    const continuing = !!getGoal(id);
    wakeCurrentGoal(id);
    return Response.json({ count: references.length, continuing });
  });
}
