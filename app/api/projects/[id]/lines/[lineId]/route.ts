import { fail, handle } from "@/lib/api";
import { lineTtsKeys } from "@/lib/pipeline/artifacts";
import { enqueueTtsSteps, ttsSteps } from "@/lib/pipeline/tts-jobs";
import { getProject } from "@/lib/server/projects";

/** 重新排队单句配音：保留旧缓存直到新音频成功，避免重录失败时成片失声。 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; lineId: string }> }) {
  return handle(async () => {
    const { id, lineId } = await ctx.params;
    const project = getProject(id);
    if (!project) return fail("项目不存在", 404);
    const item = lineTtsKeys(project.doc, id).find((k) => k.line.id === lineId);
    if (!item) return fail("句子不存在", 404);
    const [job] = enqueueTtsSteps(id, ttsSteps(project.doc, id, [item], { force: true }), { replace: true });
    return Response.json({ job, ttsKey: item.key });
  });
}
