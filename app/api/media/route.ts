import { fail, handle } from "@/lib/api";
import { putStream } from "@/lib/server/media";

const MAX = 500 * 1024 * 1024;
const allowed = new Set(["image", "audio", "video"]);

/** 上传素材：请求体直接是文件内容（不走 multipart，便于大文件流式写盘） */
export async function POST(req: Request) {
  return handle(async () => {
    if (!req.body) return fail("缺少文件内容");
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX) return fail("文件超过 500MB 上限", 413);
    const name = decodeURIComponent(req.headers.get("x-file-name") ?? "");
    const asset = await putStream(req.body, MAX, { meta: { originalName: name, source: "upload" } });
    if (!allowed.has(asset.kind)) return fail("只支持图片、音频和视频文件");
    return Response.json(asset);
  });
}
