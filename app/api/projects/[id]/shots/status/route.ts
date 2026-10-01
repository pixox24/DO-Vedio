import { fail, handle } from "@/lib/api";
import type { JobStatus } from "@/lib/core/types";
import { all } from "@/lib/server/db";
import { getProject } from "@/lib/server/projects";

type ShotStatus = { status: JobStatus; progress: number; message: string; error: string | null; total: number; done: number; failed: number; running: number };

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
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/shots/status">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const project = getProject(id);
    if (!project) return fail("项目不存在", 404);

    const rows = all<{
      shot_id: string;
      status: JobStatus;
      progress: number;
      message: string;
      error: string | null;
      batch_id: string | null;
      created_at: number;
    }>(
      `SELECT json_extract(input, '$.shotId') AS shot_id,
              status, progress, message, error,
              json_extract(input, '$.batchId') AS batch_id,
              created_at
       FROM jobs
       WHERE project_id = ? AND stage = 'shot-generate' AND json_extract(input, '$.shotId') IS NOT NULL
       ORDER BY created_at DESC`,
      id,
    );

    // 每个镜头只看它最近一次提交的那一批，避免历史任务的状态被误读成当前状态
    const latestBatch = new Map<string, string>();
    const out: Record<string, ShotStatus> = {};
    for (const row of rows) {
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
    return Response.json(out);
  });
}
