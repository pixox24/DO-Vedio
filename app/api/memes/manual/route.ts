import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { memeCategoryIds } from "@/lib/memes";
import { addMemeByTerm } from "@/lib/server/meme-fetch";

export const maxDuration = 180;

const body = z.object({ term: z.string().trim().min(1, "请输入表达").max(24).refine((v) => !/[<>\x00-\x1f\x7f]/.test(v), "不能包含 HTML 或控制字符"), category: z.enum(memeCategoryIds).default("hot") });

export async function POST(req: Request) {
  return handle(async () => {
    const { term, category } = await parseBody(req, body);
    return Response.json(await addMemeByTerm(term, category));
  });
}
