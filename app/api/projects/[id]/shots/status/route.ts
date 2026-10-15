import { sourceImageSnapshot, sourceImageConfirmed, videoGenerationSnapshot, videoShotTiming } from "@/lib/core/video";
import { timelineFor } from "@/lib/pipeline/artifacts";
import { videoFrame, videoRenderProblems } from "@/lib/pipeline/video-generation";
import { findOriginalMediaAttempt } from "@/lib/providers/runs";
import { projectJobs } from "@/lib/server/jobs";
import { fail, handle } from "@/lib/api";
import { outputSpecForRequest } from "@/lib/core/output-spec";
import type { JobStatus } from "@/lib/core/types";
import { all } from "@/lib/server/db";
import { getProject } from "@/lib/server/projects";
import { videoPlanNeedsSync } from "@/lib/core/video-plan";
import { shotReferenceStatus } from "@/lib/core/reference-status";

type ShotStatus = { state?: string; snapshotHash?: string; attemptId?: string; providerTaskId?: string; sourceImageAssetId?: string; costStatus?: string; targetDurationMs?: number; requestDurationSeconds?: number; status: JobStatus; progress: number; message: string; error: string | null; total: number; done: number; failed: number; running: number };

/**
 * 镜头生成任务状态，由服务端裁决。
 *
 * 客户端原来从 jobs Map 里按「stage + target 字符串」找，但镜头改过描述后会产生
 * 不同 key 的多条任务、Map 又是插入序，取到哪条不确定——卡片会显示过期的
 * 「已完成 / 生成失败」。
 *
 * 这里直接按任务 input 里的 shotId 查（生图任务写入时带了这个字段），
 * 只认**最新一批**（同一次提交共享一个 batchId），所以改过描述之后旧任务不会顶上来。
 */
export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/shots/status">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const project = getProject(id);
    if (!project) return fail("项目不存在", 404);
    const requestedSpecId = new URL(req.url).searchParams.get("outputSpecId");
    if (requestedSpecId && requestedSpecId !== "landscape-1080p" && requestedSpecId !== "portrait-1080p") return fail("输出规格无效");
    const sourceFrame = videoFrame(project.doc);
    const perOutputVideo = project.doc.settings.visualPipeline === "video" && project.doc.settings.assetFraming === "per-output";
    const requestedSpec = requestedSpecId === "landscape-1080p" || requestedSpecId === "portrait-1080p" ? requestedSpecId : undefined;
    const outputFrame = perOutputVideo && requestedSpec ? outputSpecForRequest(project.doc.settings, requestedSpec) : sourceFrame;

    const rows = all<{
      shot_id: string;
      status: JobStatus;
      progress: number;
      message: string;
      error: string | null;
      batch_id: string | null;
      created_at: number;
      frame_aspect: string | null;
    }>(
      `SELECT json_extract(input, '$.shotId') AS shot_id,
              status, progress, message, error,
              json_extract(input, '$.batchId') AS batch_id,
              created_at, json_extract(input, '$.frame.aspect') AS frame_aspect
       FROM jobs
       WHERE project_id = ? AND stage = 'shot-generate' AND json_extract(input, '$.shotId') IS NOT NULL
       ORDER BY created_at DESC`,
      id,
    );

    // 每个镜头只看它最近一次提交的那一批，避免历史任务的状态被误读成当前状态
    const latestBatch = new Map<string, string>();
    const out: Record<string, ShotStatus> = {};
    for (const row of rows.filter((row) => !perOutputVideo || row.frame_aspect === outputFrame.aspect)) {
      const batchKey = row.batch_id ?? `legacy:${row.created_at}`;
      const seen = latestBatch.get(row.shot_id);
      if (seen === undefined) latestBatch.set(row.shot_id, batchKey);
      else if (seen !== batchKey) continue;

      const entry = out[row.shot_id] ?? { status: row.status, progress: 0, message: "", error: null, total: 0, done: 0, failed: 0, running: 0 };
      entry.total += 1;
      if (row.status === "succeeded") entry.done += 1;
      else if (row.status === "failed") entry.failed += 1;
      else if (row.status === "queued" || row.status === "running") entry.running += 1;
      // 聚合进度：整批完成数 + 运行中任务的部分进度
      entry.progress = entry.total ? (entry.done + (row.status === "running" ? row.progress : 0)) / entry.total : 0;
      // 失败优先展示，其次展示正在跑的那条
      if (row.status === "failed" && !entry.error) {
        entry.status = "failed";
        entry.error = row.error;
        entry.message = row.message;
      } else if (entry.status !== "failed" && (row.status === "running" || row.status === "queued")) {
        entry.status = row.status;
        entry.message = row.message;
      } else if (entry.status !== "failed" && entry.done === entry.total) {
        entry.status = "succeeded";
      }
      out[row.shot_id] = entry;
    }
    if (project.doc.settings.visualPipeline === "video") {
      const doc = project.doc;
      const frame = outputFrame;
      const timeline = timelineFor(doc, id, frame.aspect);
      const jobs = projectJobs(id);
      for (const shot of doc.shots) {
        const timing = videoShotTiming(doc, shot, timeline);
        const snapshot = videoGenerationSnapshot(doc, shot, timeline, frame);
        const original = findOriginalMediaAttempt({ projectId: id, shotId: shot.id, requestHash: snapshot.hash });
        const reference = shotReferenceStatus(doc, shot, sourceFrame, jobs);
        const related = jobs.filter((job) => ["shot-reference", "shot-generate"].includes(job.stage) && typeof job.input === "object" && job.input !== null && (job.input as { shotId?: string }).shotId === shot.id && (job.stage === "shot-reference" || !perOutputVideo || (job.input as { frame?: { aspect?: string } }).frame?.aspect === frame.aspect)).sort((a, b) => b.createdAt - a.createdAt);
        const latest = reference.usable ? related.find((job) => job.stage === "shot-generate" && (job.input as { requestHash?: string }).requestHash === snapshot.hash) : related.find((job) => job.stage === "shot-reference");
        const input = latest?.input as { attemptId?: string; requestHash?: string } | undefined;
        const entry = out[shot.id] ?? { status: latest?.status ?? "queued", progress: latest?.progress ?? 0, message: latest?.message ?? "", error: latest?.error ?? null, total: latest ? 1 : 0, done: 0, failed: 0, running: 0 };
        const activeVideo = latest?.stage === "shot-generate" && input?.requestHash === snapshot.hash && ["queued", "running"].includes(latest.status);
        let state: string;
        if (videoPlanNeedsSync(shot)) state = "waiting-plan";
        else if (!timing.ready) state = "waiting-tts";
        else if (!reference.usable) state = reference.kind === "failed" || reference.kind === "canceled" ? reference.kind : "waiting-reference";
        else if (!doc.settings.video.autoContinue && !sourceImageConfirmed(doc, shot, sourceFrame)) state = "waiting-confirmation";
        else if (original?.params.phase === "submission-unknown") state = "submission-unknown";
        else if (latest?.status === "failed" && input?.requestHash === snapshot.hash) state = "failed";
        else if (latest?.status === "canceled" && input?.requestHash === snapshot.hash) state = "canceled";
        else if (activeVideo) state = latest?.status === "queued" ? "queued" : original?.params.phase ?? "submitting";
        else if (!videoRenderProblems({ ...doc, shots: [shot] }, timeline, frame).length) state = "ready";
        else if (original?.params.phase === "failed") state = "failed";
        else if (original?.params.phase === "canceled") state = "canceled";
        else if (original) state = "failed";
        else state = shot.assetId ? "stale" : "ready-to-generate";
        out[shot.id] = { ...entry, state, error: state === "failed" ? reference.error ?? latest?.error ?? null : null, snapshotHash: sourceImageSnapshot(doc, shot, sourceFrame).hash,
          attemptId: original?.params.attemptId ?? (input?.requestHash === snapshot.hash ? input.attemptId : undefined),
          providerTaskId: original?.params.taskId, sourceImageAssetId: shot.sourceImageAssetId,
          costStatus: original?.params.costStatus ?? "unknown", targetDurationMs: timing.targetDurationMs, requestDurationSeconds: timing.requestDurationSeconds,
        } as ShotStatus;
      }
    }
    return Response.json(out);
  });
}
