import { fail, handle } from "@/lib/api";
import { lineSpeech } from "@/lib/core/keys";
import { lineTtsKeys } from "@/lib/pipeline/artifacts";
import { ttsJobKeyOf } from "@/lib/pipeline/tts-jobs";
import { billedCharsOf, estimateTtsCost } from "@/lib/pipeline/pricing";
import { syncLines } from "@/lib/pipeline/plan";
import { cacheMany } from "@/lib/server/cache";
import { latestJobByKey } from "@/lib/server/jobs";
import { effectiveLexicon } from "@/lib/server/lexicon";
import { getProject, mutateProject } from "@/lib/server/projects";
import type { TtsResult } from "@/lib/core/keys";
import { mediaUrl } from "@/lib/core/types";
import { getProviderProfile } from "@/lib/providers/registry";

/** 句子列表的派生信息：朗读文本、配音状态、试听地址、重录成本 */
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
    const voiceProfile = getProviderProfile(p.doc.settings.voice.provider, p.doc.settings.voice.model);
    // 重录成本。逐句：自身朗读文本；段落模式：整块拼接文本——与实际执行（tts-jobs 的起点）完全一致，
    // 否则「补齐缺失」这类入口会按句累加、低估真实花费。
    const { provider, model } = p.doc.settings.voice;
    const lineCost = keys.map((k) => estimateTtsCost(provider, model, billedCharsOf(k.spoken)));
    const blockCost = new Map<string, number>();
    for (const k of keys) {
      if (k.block && !blockCost.has(k.block.key)) {
        blockCost.set(k.block.key, estimateTtsCost(provider, model, billedCharsOf(k.block.members.map((m) => m.spoken).join(k.block.joiner))));
      }
    }
    return Response.json({
      revision: p.revision,
      lines: keys.map((k, index) => {
        const tts = hits.get(k.key);
        const latest = latestJobByKey(ttsJobKeyOf(k), id);
        const job = latest && (!tts || latest.status === "queued" || latest.status === "running" || latest.status === "failed") ? latest : undefined;
        return {
          id: k.line.id,
          spoken: lineSpeech(k.line, lex).spoken,
          ttsKey: k.key,
          costYuan: lineCost[index],
          // 段落模式：重录本段要整块重算，成本是块级的
          blockCostYuan: k.block ? blockCost.get(k.block.key) ?? 0 : null,
          audio: tts ? { src: mediaUrl(tts.assetId), startMs: tts.speechStartMs, endMs: tts.speechEndMs, aligned: tts.aligned, alignmentSource: tts.alignmentSource ?? (tts.aligned ? "provider" : "estimated") } : null,
          // 段落配音：同一块的句子共享 key；有音频后带上切分置信度和整段音频
          block: k.block ? {
            key: k.block.key,
            index: k.block.index,
            count: k.block.members.length,
            confidence: tts?.block?.confidence ?? null,
            blockSrc: tts?.block ? mediaUrl(tts.block.blockAssetId) : null,
            splitSource: tts?.block?.splitSource ?? null,
            subKey: tts?.block?.key ?? null,
            // 实际合成结果：整段切分 / 拆小后切分（所在子块句数少于计划）/ 退回逐句
            outcome: !tts ? null : !tts.block ? "line" : tts.block.count < k.block.members.length ? "halved" : "block",
          } : null,
          capabilities: voiceProfile?.capabilities ?? [],
          job: job ? { id: job.id, status: job.status, error: job.error } : null,
        };
      }),
    });
  });
}
