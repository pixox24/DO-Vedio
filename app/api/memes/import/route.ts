import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { memeInputSchema } from "@/lib/memes";
import { importCandidates } from "@/lib/server/meme-fetch";

// 核实热度时逐个联网搜索
export const maxDuration = 180;

const body = z.object({
  items: z.array(memeInputSchema).min(1, "请至少勾选一个梗").max(50, "一次最多导入 50 个"),
  /** 联网核实热度和流行时间（只更新这两项，不判断真假） */
  verify: z.boolean().default(true),
});

/** 粘贴导入第二步：导入用户勾选并改好的条目 */
export async function POST(req: Request) {
  return handle(async () => {
    const { items, verify } = await parseBody(req, body);
    return Response.json(await importCandidates(items, { verify }));
  });
}
