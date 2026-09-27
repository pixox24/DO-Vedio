import { handle, loadStyle, parseBody, withBrief } from "@/lib/api";
import { pickMemes } from "@/lib/server/meme-fetch";

// 梗库为空时会先联网抓一轮
export const maxDuration = 300;

export async function POST(req: Request) {
  return handle(async () => {
    const { brief, modelId } = await parseBody(req, withBrief);
    const { template } = await loadStyle(brief);
    return Response.json(await pickMemes(brief, template, modelId));
  });
}
