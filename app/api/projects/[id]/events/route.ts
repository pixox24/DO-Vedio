import { projectJobs, workerOnline } from "@/lib/server/jobs";
import { projectRevision } from "@/lib/server/projects";
import { projectSpend } from "@/lib/server/cache";

/**
 * 进度推送（SSE）。每秒查一次数据库，只发变化：
 *   event: jobs      变化的任务（每个 key 最新一条）
 *   event: revision  文档被改（通常是 Worker 写回了结果）
 *   event: worker    Worker 在线状态
 *   event: spend     累计花费
 */
export async function GET(req: Request, ctx: RouteContext<"/api/projects/[id]/events">) {
  const { id } = await ctx.params;
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let since = 0;
      let revision = -1;
      let online: boolean | null = null;
      let spend = -1;
      let ticks = 0;
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const tick = () => {
        try {
          const now = Date.now();
          const jobs = projectJobs(id, since);
          if (jobs.length) {
            send("jobs", jobs);
            since = Math.max(since, ...jobs.map((j) => j.updatedAt));
          }
          const rev = projectRevision(id);
          if (rev === undefined) {
            send("gone", {});
            return close();
          }
          if (rev !== revision) {
            if (revision !== -1) send("revision", { revision: rev });
            revision = rev;
          }
          const on = workerOnline();
          if (on !== online) send("worker", { online: (online = on) });
          const s = projectSpend(id).costYuan;
          if (s !== spend) send("spend", { costYuan: (spend = s) });
          if (++ticks % 15 === 0) controller.enqueue(enc.encode(`: ping ${now}\n\n`));
        } catch (e) {
          console.error(e);
        }
      };
      const close = () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      };
      send("hello", { now: Date.now() });
      tick();
      timer = setInterval(tick, 1000);
      req.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
