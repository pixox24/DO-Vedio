import { handle, parseBody } from "@/lib/api";
import { memeImportRequestSchema } from "@/lib/memes";
import { importCandidates } from "@/lib/server/meme-fetch";

// 核实热度时逐个联网搜索。热梗每批最多 50 个；口语不联网，由客户端按批写入。
export const maxDuration = 180;

/** 粘贴导入第二步：导入用户勾选并改好的条目 */
export async function POST(req: Request) {
  return handle(async () => {
    const { items, verify } = await parseBody(req, memeImportRequestSchema);
    return Response.json(await importCandidates(items, { verify }));
  });
}
