import { handle } from "@/lib/api";
import { all } from "@/lib/server/db";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/renders">) {
  return handle(async () => {
    const { id } = await ctx.params;
    const rows = all<{ id: string; aspect: string; quality: string; timeline_hash: string; content_hash: string; animation_hash: string; video_hash: string; srt_hash: string | null; duration_ms: number; loudness: number | null; created_at: number; output_version: number }>(
      "SELECT * FROM renders WHERE project_id = ? ORDER BY created_at DESC LIMIT 30",
      id,
    );
    return Response.json(
      rows.map((r) => ({ id: r.id, aspect: r.aspect, quality: r.quality, timelineHash: r.timeline_hash, contentHash: r.content_hash, animationHash: r.animation_hash, videoHash: r.video_hash, srtHash: r.srt_hash, durationMs: r.duration_ms, loudness: r.loudness, createdAt: r.created_at, outputVersion: r.output_version })),
    );
  });
}
