import { mediaUrl } from "@/lib/core/types";
import { scanLibrary } from "@/lib/server/music";

/** 扫描 bgm/ 并返回曲目。打开配乐面板时调用。 */
export async function GET() {
  const { tracks, problems } = await scanLibrary();
  return Response.json({
    tracks: tracks.map((track) => ({
      id: track.id,
      title: track.title,
      durationMs: track.durationMs,
      src: track.assetId ? mediaUrl(track.assetId) : "",
    })),
    problems,
  });
}
