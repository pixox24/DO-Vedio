import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { addMemeByTerm } from "@/lib/server/meme-fetch";

export const maxDuration = 180;

const body = z.object({ term: z.string().trim().min(1, "请输入梗").max(24).refine((v) => !/[<>\x00-\x1f\x7f]/.test(v), "不能包含 HTML 或控制字符") });

export async function POST(req: Request) {
  return handle(async () => Response.json(await addMemeByTerm((await parseBody(req, body)).term)));
}
