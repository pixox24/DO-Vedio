import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { memeCircles } from "@/lib/memes";
import { fetchMemes } from "@/lib/server/meme-fetch";

// 联网搜索 + 整理两次调用，多引擎搜索较慢
export const maxDuration = 300;

const body = z.object({
  topic: z.string().trim().max(60).default(""),
  /** 只搜某个圈层 */
  circle: z.enum(["", ...memeCircles]).default(""),
  /** 搜索时间窗口（月） */
  months: z.union([z.literal(1), z.literal(3), z.literal(6)]).default(1),
});

export async function POST(req: Request) {
  return handle(async () => {
    const { topic, circle, months } = await parseBody(req, body);
    return Response.json(await fetchMemes(topic ? "topic" : circle ? "circle" : "trending", topic, circle, months));
  });
}
