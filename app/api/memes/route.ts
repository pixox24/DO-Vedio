import { handle } from "@/lib/api";
import { searchModel } from "@/lib/llm";
import { effectiveHeat } from "@/lib/memes";
import { lastFetch, latestSuccessfulFetch, listBlocks, listMemes, recheckTargets } from "@/lib/server/memes";

export async function GET() {
  return handle(async () => {
    const now = Date.now();
    // 最近一次成功抓取时新增的梗（入库和抓取记录用同一个时间戳）
    const latest = latestSuccessfulFetch();
    const isNew = (m: { source: string; createdAt: number }) => !!latest && latest.added > 0 && m.source === "search" && m.createdAt === latest.createdAt;
    return Response.json({
      memes: listMemes().map((m) => ({ ...m, heat: effectiveHeat(m.heat, m.verifiedAt, now), storedHeat: m.heat, isNew: isNew(m) })),
      lastFetch: lastFetch("trending") ?? null,
      latestFetch: latest ?? null,
      blocks: listBlocks(),
      /** 需要复核的数量（没核实过的和超过 30 天没确认的） */
      recheckCount: recheckTargets(Number.MAX_SAFE_INTEGER, 30, now).length,
      searchModel: searchModel() ?? null,
    });
  });
}
