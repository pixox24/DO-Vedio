import { mediaUrl } from "@/lib/core/types";
import { listTracks, readManifest } from "@/lib/server/music";

export async function GET() {
  const { problems } = await readManifest();
  return Response.json({ tracks: listTracks().map((t) => ({ ...t, src: mediaUrl(t.assetId) })), problems });
}
