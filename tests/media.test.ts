import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-media-"));
  process.env.DATA_DIR = dir;
});

afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});

describe("媒体 Range 服务", () => {
  it("返回 206、Content-Range 和正确字节片段", async () => {
    const { putBuffer } = await import("@/lib/server/media");
    const { GET } = await import("@/app/api/media/[hash]/route");
    const asset = await putBuffer(Buffer.from("0123456789"), { ext: "bin", mime: "application/octet-stream", probe: false });
    const response = await GET(new Request("http://localhost/api/media/x", { headers: { range: "bytes=2-5" } }), { params: Promise.resolve({ hash: asset.hash }) });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 2-5/10`);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(await response.text()).toBe("2345");
  });
});
