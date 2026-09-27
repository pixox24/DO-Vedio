import { handle } from "@/lib/api";
import { recheckMemes } from "@/lib/server/meme-fetch";

// 逐个联网核实，30 个大约两三分钟
export const maxDuration = 300;

/** 复核现有的梗：没核实过的和超过 30 天没确认的 */
export async function POST() {
  return handle(async () => Response.json(await recheckMemes()));
}
