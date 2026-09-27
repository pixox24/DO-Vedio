import { fail, handle } from "@/lib/api";
import { lineSpeech, ttsKey, ttsRequestForLine } from "@/lib/core/keys";
import { enqueue } from "@/lib/server/jobs";
import { effectiveLexicon } from "@/lib/server/lexicon";
import { getProject } from "@/lib/server/projects";
import { run } from "@/lib/server/db";

/** 重新排队单句配音：清掉该句的旧缓存，后续时间轴会使用新结果。 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; lineId: string }> }) {
  return handle(async () => {
    const { id, lineId } = await ctx.params;
    const project = getProject(id);
    if (!project) return fail("项目不存在", 404);
    const line = project.doc.lines.find((x) => x.id === lineId);
    if (!line) return fail("句子不存在", 404);
    const lex = effectiveLexicon(id);
    const speech = lineSpeech(line, lex);
    const tts = ttsRequestForLine(speech.spoken, line, project.doc.settings.voice.model);
    const key = ttsKey(tts.text, project.doc.settings.voice, tts.textType);
    run("DELETE FROM cache WHERE key = ?", key);
    run("DELETE FROM jobs WHERE project_id = ? AND key = ? AND status IN ('queued', 'running')", id, key);
    const job = enqueue({
      projectId: id,
      stage: "tts",
      key,
      target: `第 ${project.doc.lines.findIndex((x) => x.id === lineId) + 1} 句`,
      input: { projectId: id, lineId, text: line.text, spoken: speech.spoken, ttsText: tts.text, textType: tts.textType, map: speech.map, voice: project.doc.settings.voice },
      priority: 4,
    });
    return Response.json({ job, ttsKey: key });
  });
}
