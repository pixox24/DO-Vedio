import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { errorMessage } from "@/lib/llm";
import { pexelsApiKey, searchVideos } from "@/lib/providers/stock/pexels";
import { defaultStockSource, stockConfigured } from "@/lib/providers/stock";

/**
 * 素材来源的状态与连通性检查，给设置面板用。
 *
 * 为什么不做成 `providerKinds` 里的一类：`providerKinds`
 * （`lib/providers/types.ts`）是**生成式**服务商的分类，Pexels 只做检索。
 * 塞进去会让视频模型下拉框多出一个选不了的「模型」，用量口径也会混。
 * 所以这里是一条独立的轻量路由。
 */

export async function GET() {
  return Response.json({
    configured: stockConfigured(),
    provider: defaultStockSource.id,
    label: defaultStockSource.label,
    hint: pexelsApiKey() ? undefined : "在 .env.local 配置 PEXELS_API_KEY 后重启后台",
  });
}

/** 请求体可空：面板点「测试连接」时不需要带任何参数。 */
const testBody = z.object({ query: z.string().trim().min(1).max(60).optional() }).strict().nullable().transform((value) => value ?? {});

/**
 * 打一次真实检索做连通性测试。
 *
 * 用 `nature` 这种一定搜得到的词：这里要验证的是「Key 能不能用、网络通不通」，
 * 不是「这个词搜不搜得到」。失败一律返回 200 + `ok:false`，让面板直接显示原因，
 * 而不是弹一个 500。
 */
export async function POST(req: Request) {
  return handle(async () => {
    const { query } = await parseBody(req, testBody);
    try {
      const clips = await searchVideos(query ?? "nature", { perPage: 1 }, AbortSignal.timeout(15_000));
      const first = clips[0];
      if (!first) return Response.json({ ok: false, message: "连接成功，但没有返回任何素材" });
      return Response.json({ ok: true, provider: defaultStockSource.id, count: clips.length, sample: { id: first.id, durationSec: first.durationSec, width: first.width, height: first.height } });
    } catch (e) {
      return Response.json({ ok: false, message: errorMessage(e) });
    }
  });
}
