import { createReadStream, promises as fs } from "fs";
import { Readable } from "stream";
import { fail } from "@/lib/api";
import { assetFile, getAsset } from "@/lib/server/media";

/** 媒体文件：内容寻址、永久缓存，支持 Range（播放器拖动进度依赖它） */
export async function GET(req: Request, ctx: RouteContext<"/api/media/[hash]">) {
  const { hash } = await ctx.params;
  const asset = getAsset(hash);
  if (!asset) return fail("素材不存在", 404);
  const file = assetFile(asset);
  const size = await fs.stat(file).then((s) => s.size, () => -1);
  if (size < 0) return fail("素材文件丢失", 404);

  const url = new URL(req.url);
  const headers: Record<string, string> = {
    "Content-Type": asset.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: `"${asset.hash}"`,
  };
  const name = url.searchParams.get("download");
  if (name) headers["Content-Disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
  if (req.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });

  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    return new Response(stream(file, req.signal, start, end), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(stream(file, req.signal), { headers: { ...headers, "Content-Length": String(size) } });
}

function stream(file: string, signal: AbortSignal, start?: number, end?: number) {
  const s = createReadStream(file, { start, end });
  signal.addEventListener("abort", () => s.destroy(), { once: true });
  return Readable.toWeb(s) as ReadableStream<Uint8Array>;
}
