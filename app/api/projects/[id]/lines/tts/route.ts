import { z } from "zod";
import { fail, handle, parseBody } from "@/lib/api";
import { lineSpeech, ttsKey, ttsRequestForLine } from "@/lib/core/keys";
import { effectiveLexicon } from "@/lib/server/lexicon";
import { getProject } from "@/lib/server/projects";
import { enqueue } from "@/lib/server/jobs";
import { billedCharsOf, estimateTtsCost } from "@/lib/pipeline/pricing";
import { dashscopeTts } from "@/lib/providers/tts/dashscope";
import { cacheGet } from "@/lib/server/cache";
import { run } from "@/lib/server/db";
import type { TtsResult } from "@/lib/core/keys";

const body = z.object({ mode: z.enum(["all", "missing"]).default("all") });

/** 批量重录：all 强制覆盖当前音色缓存，missing 只补没有音频的句子。 */
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/lines/tts">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const project = getProject(id);
    if (!project) return fail("项目不存在", 404);
    const { mode } = await parseBody(req, body);
    const lex = effectiveLexicon(id);
    const rows = project.doc.lines.map((line, index) => {
      const speech = lineSpeech(line, lex);
      const tts = ttsRequestForLine(speech.spoken, line, project.doc.settings.voice.model);
      const key = ttsKey(tts.text, project.doc.settings.voice, tts.textType);
      const hit = cacheGet<TtsResult>(key);
      return { line, index, speech, ttsText: tts.text, textType: tts.textType, key, hit };
    }).filter((row) => mode === "all" || !row.hit);
    if (!rows.length) return fail(mode === "missing" ? "所有句子都已有配音" : "没有可重录的句子", 409);
    const provider = dashscopeTts();
    const jobs = rows.map((row) => {
      run("DELETE FROM jobs WHERE project_id = ? AND key = ? AND status IN ('queued', 'running')", id, row.key);
      return enqueue({
        projectId: id,
        stage: "tts",
        key: row.key,
        target: `第 ${row.index + 1} 句`,
        input: { projectId: id, lineId: row.line.id, text: row.line.text, spoken: row.speech.spoken, ttsText: row.ttsText, textType: row.textType, map: row.speech.map, voice: project.doc.settings.voice, force: mode === "all" },
        priority: 4,
        costEstimate: estimateTtsCost(provider.id, project.doc.settings.voice.model, billedCharsOf(row.speech.spoken)),
      });
    });
    return Response.json({ count: jobs.length, jobs, mode });
  });
}
