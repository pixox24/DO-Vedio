import { replicateImageAdapter, replicateVideoAdapter } from "../providers/media/replicate";
import { generateCustomImage } from "../providers/media/openai-image";
import { promises as fs } from "fs";
import { assetFile, getAsset, kindOfMime, putBuffer, sniff } from "../server/media";
import { PermanentError } from "./stage";
import { longRequest, networkError } from "../providers/http";
import { cacheGet, cachePut } from "../server/cache";

/** 生图 / 生视频的公共流程：调用适配器 → 下载 → 校验文件类型 → 入素材库。镜头生成和风格样张共用。 */

export type MediaRequest = {
  kind: "image" | "video";
  modelId: string;
  prompt: string;
  /** 参考图的素材 ID（角色定妆、上传的参考等），按优先级排列 */
  references?: string[];
  seed?: number;
  firstFrame?: string;
  lastFrame?: string;
  controlImage?: string;
  /** 写进素材元数据 */
  meta: Record<string, unknown>;
};

/** 模型中心里自定义的 OpenAI 兼容生图模型（有参考图时走 /images/edits） */
export const isCustomImageModel = (kind: MediaRequest["kind"], modelId: string) => kind === "image" && modelId.startsWith("custom-");
export const mediaProviderId = (kind: MediaRequest["kind"], modelId: string) => (isCustomImageModel(kind, modelId) ? modelId.split("::")[0] : "replicate");

async function loadAsset(hash: string) {
  const asset = getAsset(hash);
  if (!asset) throw new PermanentError(`参考素材不存在：${hash}`);
  return { bytes: new Uint8Array(await fs.readFile(assetFile(asset))), mime: asset.mime };
}

export async function assetDataUri(hash: string | undefined) {
  if (!hash) return undefined;
  const { bytes, mime } = await loadAsset(hash);
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

export type MediaResult = { assets: string[]; /** 参考图没有生效的原因（写进生成记录） */ referenceFallback?: string };

export async function generateMediaAssets(req: MediaRequest, signal: AbortSignal): Promise<MediaResult> {
  const custom = isCustomImageModel(req.kind, req.modelId);
  const refs = req.references ?? [];
  let referenceFallback: string | undefined;
  let outputs: ({ bytes: Uint8Array } | { url: string })[];
  if (custom) {
    const result = await generateCustomImage(req.modelId, req.prompt, signal, await Promise.all(refs.map(loadAsset)));
    referenceFallback = result.referenceFallback;
    outputs = [result];
  } else {
    const referenceImages = (await Promise.all(refs.map(assetDataUri))).filter((x): x is string => !!x);
    const result = await (req.kind === "image" ? replicateImageAdapter() : replicateVideoAdapter()).generate(
      { prompt: req.prompt, referenceImages, seed: req.seed, firstFrame: req.firstFrame, lastFrame: req.lastFrame, controlImage: req.controlImage },
      signal,
    );
    outputs = result.outputUrls.slice(0, 4).map((url) => ({ url }));
  }
  const assets: string[] = [];
  for (const output of outputs) {
    const response =
      "url" in output
        ? await fetch(output.url, { signal, ...longRequest }).catch((e) => {
            throw networkError(e, "下载生成素材");
          })
        : null;
    if (response && !response.ok) throw new Error(`下载生成素材失败（HTTP ${response.status}）`);
    const bytes = "bytes" in output ? output.bytes : new Uint8Array(await response!.arrayBuffer());
    if (bytes.byteLength > 200 * 1024 * 1024) throw new PermanentError("生成素材超过 200MB 限制");
    const detected = sniff(bytes.slice(0, 16));
    if (!detected || kindOfMime(detected.mime) !== req.kind) throw new PermanentError("生成接口返回的文件类型不正确");
    const asset = await putBuffer(bytes, { ext: detected.ext, mime: detected.mime, meta: { source: custom ? req.modelId : "replicate", ...req.meta } });
    assets.push(asset.hash);
  }
  if (!assets.length) throw new Error("生成结果为空");
  return { assets, referenceFallback };
}

/** 一批图同时生成几张：太多容易触发服务商限流 */
export const BATCH_CONCURRENCY = 4;

/**
 * 一批素材并行生成，每一项单独缓存：
 * - 完成一项就回调 onAsset（调用方立刻写回文档，前端马上能看到）
 * - 失败的不影响成功的；任务重试时已成功的直接从缓存取，不再重复花钱
 * 全部结束后，有失败就抛错（交给任务系统重试缺的那几项）；全是永久错误则不再重试。
 */
export async function generateBatch<T>(
  items: T[],
  opts: {
    /** 每一项的缓存键：同一次任务的重试必须相同 */
    itemKey: (index: number) => string;
    run: (item: T, index: number) => Promise<string>;
    onAsset?: (index: number, asset: string) => void;
    onProgress?: (done: number, total: number) => void;
    concurrency?: number;
    signal: AbortSignal;
  },
): Promise<string[]> {
  const slots: (string | undefined)[] = items.map((_, i) => cacheGet<{ asset: string }>(opts.itemKey(i))?.asset);
  let done = slots.filter(Boolean).length;
  slots.forEach((asset, i) => asset && opts.onAsset?.(i, asset));
  opts.onProgress?.(done, items.length);
  const queue = items.map((_, i) => i).filter((i) => !slots[i]);
  const errors: unknown[] = [];
  const worker = async () => {
    for (let i = queue.shift(); i !== undefined && !opts.signal.aborted; i = queue.shift()) {
      try {
        const asset = await opts.run(items[i], i);
        cachePut(opts.itemKey(i), "media-item", { asset });
        slots[i] = asset;
        done++;
        opts.onAsset?.(i, asset);
        opts.onProgress?.(done, items.length);
      } catch (e) {
        errors.push(e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? BATCH_CONCURRENCY, queue.length) }, worker));
  if (opts.signal.aborted) throw Object.assign(new Error("已取消"), { name: "AbortError" });
  if (errors.length) {
    const first = errors[0] instanceof Error ? errors[0].message : String(errors[0]);
    const message = `${done}/${items.length} 张成功，${errors.length} 张失败：${first}`;
    throw errors.every((e) => e instanceof PermanentError) ? new PermanentError(message) : new Error(message);
  }
  return slots as string[];
}
