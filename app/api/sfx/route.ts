import { handle } from "@/lib/api";
import { mediaUrl } from "@/lib/core/types";
import { sfxSourcesOf } from "@/lib/pipeline/artifacts";
import { ensureSfx } from "@/lib/server/music";

/** 动画库试听用。缺文件时现合成，返回每个角色的媒体地址。 */
export async function GET() {
  return handle(async () => {
    await ensureSfx();
    return Response.json(sfxSourcesOf(mediaUrl));
  });
}
