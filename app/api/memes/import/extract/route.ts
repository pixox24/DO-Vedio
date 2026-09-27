import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { extractMemes } from "@/lib/server/meme-fetch";

export const maxDuration = 180;

const body = z.object({ text: z.string().trim().min(10, "内容太短").max(20_000, "内容太长，请分几次导入") });

/** 粘贴导入第一步：从材料里抽取候选，不入库 */
export async function POST(req: Request) {
  return handle(async () => Response.json(await extractMemes((await parseBody(req, body)).text)));
}
