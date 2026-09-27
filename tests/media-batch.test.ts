import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "dovedio-batch-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  (await import("@/lib/server/db")).closeDb();
  rmSync(dir, { recursive: true, force: true });
});

const signal = new AbortController().signal;

describe("批量生成", () => {
  it("并行生成；失败的不影响成功的；重试只补缺的，不重复花钱", async () => {
    const { generateBatch } = await import("@/lib/pipeline/media-gen");
    const calls: number[] = [];
    const written: number[] = [];
    let active = 0;
    let peak = 0;
    let failTwo = true;
    const run = async (_: unknown, i: number) => {
      calls.push(i);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      if (i === 2 && failTwo) throw new Error("生图失败：等待服务商返回结果超时");
      return `asset-${i}`;
    };
    const opts = { itemKey: (i: number) => `batch-test:${i}`, run, signal, onAsset: (i: number) => written.push(i) };
    await expect(generateBatch([0, 1, 2, 3], opts)).rejects.toThrow("3/4 张成功，1 张失败：生图失败：等待服务商返回结果超时");
    expect(peak).toBe(4);
    expect(written.sort()).toEqual([0, 1, 3]);
    calls.length = 0;
    written.length = 0;
    failTwo = false;
    await expect(generateBatch([0, 1, 2, 3], opts)).resolves.toEqual(["asset-0", "asset-1", "asset-2", "asset-3"]);
    expect(calls).toEqual([2]);
    // 缓存里的也会回调，调用方据此把之前成功的写回
    expect(written.sort()).toEqual([0, 1, 2, 3]);
  });

  it("全是永久错误时不再重试", async () => {
    const { generateBatch } = await import("@/lib/pipeline/media-gen");
    const { PermanentError } = await import("@/lib/pipeline/stage");
    await expect(generateBatch([0], { itemKey: () => "perm:0", run: async () => { throw new PermanentError("生成接口返回的文件类型不正确"); }, signal })).rejects.toBeInstanceOf(PermanentError);
  });
});

describe("网络错误", () => {
  it("把 fetch failed 翻译成原因，其他错误原样返回", async () => {
    const { networkError } = await import("@/lib/providers/http");
    const e = Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } });
    expect(networkError(e, "生图").message).toBe("生图失败：等待服务商返回结果超时（UND_ERR_HEADERS_TIMEOUT）");
    const other = new Error("余额不足");
    expect(networkError(other)).toBe(other);
  });
});
