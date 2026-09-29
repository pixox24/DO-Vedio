import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { getProject } from "@/lib/server/projects";
import { lineTtsKeys } from "@/lib/pipeline/artifacts";
import { enqueueTtsSteps, ttsSteps } from "@/lib/pipeline/tts-jobs";
import { cacheMany } from "@/lib/server/cache";

const body = z.object({ mode: z.enum(["all", "missing"]).default("all") });

/** 批量重录：all 强制覆盖当前音色缓存，missing 只补没有音频的句子。 */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/lines/tts">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const project = getProject(id);
    if (!project) return fail("项目不存在", 404);
    const { mode } = await parseBody(req, body);
    const keys = lineTtsKeys(project.doc, id);
    const hits = cacheMany(keys.map((k) => k.key));
    const rows = keys.filter((k) => mode === "all" || !hits.has(k.key));
    if (!rows.length) return fail(mode === "missing" ? "所有句子都已有配音" : "没有可重录的句子", 409);
    const jobs = enqueueTtsSteps(id, ttsSteps(project.doc, id, rows, { force: mode === "all" }), { replace: true });
    return Response.json({ count: jobs.length, jobs, mode });
  });
}
