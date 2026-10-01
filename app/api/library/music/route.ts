import { mediaUrl } from "@/lib/core/types";
import { listTracks, readManifest } from "@/lib/server/music";

/**
 * 曲库列表：返回授权状态、作者、来源、时长和试听地址。
 * 支持按 status / mood / energy / q 过滤，曲库面板直接消费这些参数。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const mood = url.searchParams.get("mood");
  const energy = url.searchParams.get("energy");
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";

  const all = listTracks();
  let tracks = all;
  if (status && status !== "all") tracks = tracks.filter((t) => t.rightsStatus === status);
  if (mood && mood !== "all") tracks = tracks.filter((t) => t.moods.includes(mood));
  if (energy && energy !== "all") tracks = tracks.filter((t) => t.energy === energy);
  if (q) {
    tracks = tracks.filter((t) => [t.title, t.author, t.source, t.license, t.tags.join(" ")].join(" ").toLowerCase().includes(q));
  }

  const { problems } = await readManifest();
  return Response.json({
    tracks: tracks.map((t) => ({ ...t, src: t.assetId ? mediaUrl(t.assetId) : "" })),
    problems,
    summary: {
      total: all.length,
      usable: all.filter((t) => t.usable).length,
      pending: all.filter((t) => t.rightsStatus === "pending").length,
      rejected: all.filter((t) => t.rightsStatus === "rejected").length,
      quarantine: all.filter((t) => t.rightsStatus === "quarantine").length,
    },
  });
}
