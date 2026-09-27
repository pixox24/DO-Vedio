import { fail, handle } from "@/lib/api";
import { lineSpeech } from "@/lib/core/keys";
import { lineTtsKeys } from "@/lib/pipeline/artifacts";
import { syncLines } from "@/lib/pipeline/plan";
import { cacheMany } from "@/lib/server/cache";
import { latestJobByKey } from "@/lib/server/jobs";
import { effectiveLexicon } from "@/lib/server/lexicon";
import { getProject, mutateProject } from "@/lib/server/projects";
import type { TtsResult } from "@/lib/core/keys";
import { mediaUrl } from "@/lib/core/types";

/** 句子列表的派生信息：朗读文本、配音状态、试听地址 */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/lines">) {
  return handle(async () => {
    const { id } = await ctx.params;
    let p = getProject(id);
    if (!p) return fail("项目不存在", 404);
    // 文案改过就先同步句子（保留未改动句子的 ID）
    const synced = syncLines(p.doc);
    if (synced !== p.doc) p = mutateProject(id, (d) => syncLines(d))!;
    const lex = effectiveLexicon(id);
    const keys = lineTtsKeys(p.doc, id);
    const hits = cacheMany<TtsResult>(keys.map((k) => k.key));
    return Response.json({
      revision: p.revision,
      lines: keys.map((k) => {
        const tts = hits.get(k.key);
        const latest = latestJobByKey(k.key);
        const job = latest && (!tts || latest.status === "queued" || latest.status === "running" || latest.status === "failed") ? latest : undefined;
        return {
          id: k.line.id,
          spoken: lineSpeech(k.line, lex).spoken,
          ttsKey: k.key,
          audio: tts ? { src: mediaUrl(tts.assetId), startMs: tts.speechStartMs, endMs: tts.speechEndMs, aligned: tts.aligned } : null,
          job: job ? { id: job.id, status: job.status, error: job.error } : null,
        };
      }),
    });
  });
}
