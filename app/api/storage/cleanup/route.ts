import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { gcOrphanAssets, pruneBundles, pruneProbes, pruneTemp, purgeTrash, type CleanResult } from "@/lib/server/gc";

const body = z.object({ tasks: z.array(z.enum(["bundles", "temp", "probes", "gc", "trash"])).min(1, "请选择要执行的清理项") });

/** 手动清理：缓存与临时文件、无引用素材、回收站 */
export async function POST(req: Request) {
  return handle(async () => {
    const { tasks } = await parseBody(req, body);
    const result: { bundles?: CleanResult; temp?: CleanResult; probes?: CleanResult; gc?: Awaited<ReturnType<typeof gcOrphanAssets>>; trash?: ReturnType<typeof purgeTrash> } = {};
    for (const task of tasks) {
      if (task === "trash") result.trash = purgeTrash(0);
      // 打包缓存不立即全删：保留最近两个并避开 24 小时内新建的，防止删到正在使用的目录
      else if (task === "bundles") result.bundles = await pruneBundles();
      // 临时文件留一小时保护窗：正在渲染的中间文件会持续写入，不会被误删
      else if (task === "temp") result.temp = await pruneTemp(3_600_000);
      else if (task === "probes") result.probes = await pruneProbes(0);
    }
    // 回收素材放在最后统一执行；清空回收站后也自动跟进，用户不必再点一次
    // 素材留一小时保护窗，正在生成还没写回文档的素材不会被误删
    if (tasks.includes("gc") || tasks.includes("trash")) result.gc = await gcOrphanAssets({ graceMs: 3_600_000 });
    return Response.json({ ok: true, result });
  });
}
