import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { outputSpecForRequest } from "@/lib/core/output-spec";
import { stockFrame, stockSnapshot } from "@/lib/core/stock";
import { isVideoForm } from "@/lib/core/video";
import { getProject } from "@/lib/server/projects";
import { timelineFor } from "@/lib/pipeline/artifacts";
import { enqueueStockShot, stockPrerequisite } from "@/lib/pipeline/stages/shot-stock";
import { wakeCurrentGoal } from "@/lib/pipeline/plan";
import { PermanentError } from "@/lib/pipeline/stage";

/**
 * 单镜「重新搜索素材」。
 *
 * 游标（`excludeAssetIds`）只在 `enqueueStockShot` 里算——它从镜头已有的候选推导，
 * **不进快照哈希**。候选池被 `MAX_CANDIDATES = 8` 截断后排除集会变，一旦参与哈希，
 * 门禁就会把当前正在用的素材误判成过期。
 *
 * 请求体可空：面板点「重新搜索」时不需要带任何参数。
 */
const body = z.object({ outputSpecId: z.enum(["landscape-1080p", "portrait-1080p"]).optional(), aspect: z.enum(["16:9", "9:16"]).optional() }).strict().nullable().transform((value) => value ?? {});

export async function POST(req: Request, ctx: { params: Promise<{ id: string; shotId: string }> }) {
  return handle(async () => {
    const { id, shotId } = await ctx.params;
    const input = await parseBody(req, body);
    const project = getProject(id);
    const shot = project?.doc.shots.find((item) => item.id === shotId);
    if (!project || !shot) return fail("镜头不存在", 404);
    if (!isVideoForm(project.doc.settings.visualPipeline) || shot.kind !== "video" || !shot.videoPlan) return fail("请先重新导演生成视频分镜", 409);
    if (shot.locked) return fail("镜头已锁定，请先解锁", 409);
    const frame = input.outputSpecId || input.aspect ? stockFrame(project.doc, outputSpecForRequest(project.doc.settings, input.outputSpecId, input.aspect)) : stockFrame(project.doc);
    const prerequisite = stockPrerequisite(project.doc, shot, timelineFor(project.doc, id, frame.aspect));
    if (prerequisite) return fail(prerequisite, 409);
    try {
      const queued = enqueueStockShot(id, project.doc, shot, frame);
      wakeCurrentGoal(id);
      return Response.json({ job: queued.job, reused: queued.reused, shot: project.doc.shots.find((item) => item.id === shotId), snapshotHash: queued.requestHash });
    } catch (error) {
      if (error instanceof PermanentError) return fail(error.message, 409);
      throw error;
    }
  });
}

/** 只读：这一镜当前拿什么词去检索、指纹是什么、有没有被挡住。面板用来决定按钮状态。 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; shotId: string }> }) {
  return handle(async () => {
    const { id, shotId } = await ctx.params;
    const project = getProject(id);
    const shot = project?.doc.shots.find((item) => item.id === shotId);
    if (!project || !shot) return fail("镜头不存在", 404);
    const frame = stockFrame(project.doc);
    const timeline = timelineFor(project.doc, id, frame.aspect);
    const snapshot = stockSnapshot(project.doc, shot, timeline, frame);
    return Response.json({
      pipeline: project.doc.settings.visualPipeline,
      query: snapshot.query,
      snapshotHash: snapshot.hash,
      minDurationSec: snapshot.minDurationSec,
      attempts: shot.candidates.length,
      blocker: stockPrerequisite(project.doc, shot, timeline) ?? null,
    });
  });
}
