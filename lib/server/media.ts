import { createHash, randomUUID } from "crypto";
import { createReadStream, createWriteStream, promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { Asset, AssetKind } from "../core/types";
import { dataDir, get, json, parseJson, run } from "./db";
import { probe } from "./ffmpeg";

/**
 * 媒体存储：本地磁盘，按内容 sha256 命名，天然去重。
 * 路径 data/media/ab/cd/<hash>.<ext>；以后换对象存储只改这个文件。
 */

export const mediaRoot = () => path.join(dataDir(), "media");
const tmpDir = () => path.join(dataDir(), "tmp");

export function mediaPath(hash: string, ext: string) {
  return path.join(mediaRoot(), hash.slice(0, 2), hash.slice(2, 4), `${hash}.${ext}`);
}

export const mimeByExt: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  srt: "application/x-subrip",
  json: "application/json",
  bin: "application/octet-stream",
};

export function kindOfMime(mime: string): AssetKind {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/x-subrip") return "subtitle";
  return "other";
}

/** 按文件头魔数识别类型，不信任客户端声明的 MIME */
export function sniff(head: Uint8Array): { ext: string; mime: string } | null {
  const b = head;
  const str = (from: number, len: number) => String.fromCharCode(...b.slice(from, from + len));
  if (b[0] === 0x89 && str(1, 3) === "PNG") return { ext: "png", mime: "image/png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (str(0, 4) === "RIFF" && str(8, 4) === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (str(0, 4) === "RIFF" && str(8, 4) === "WAVE") return { ext: "wav", mime: "audio/wav" };
  if (str(0, 3) === "GIF") return { ext: "gif", mime: "image/gif" };
  if (str(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { ext: "mp3", mime: "audio/mpeg" };
  if (str(0, 4) === "fLaC") return { ext: "flac", mime: "audio/flac" };
  if (str(0, 4) === "OggS") return { ext: "ogg", mime: "audio/ogg" };
  if (str(0, 4) === "\x1aE\xdf\xa3") return { ext: "webm", mime: "video/webm" };
  if (str(4, 4) === "ftyp") {
    const brand = str(8, 4);
    if (brand.startsWith("M4A")) return { ext: "m4a", mime: "audio/mp4" };
    if (brand === "qt  ") return { ext: "mov", mime: "video/quicktime" };
    return { ext: "mp4", mime: "video/mp4" };
  }
  return null;
}

type AssetRow = {
  hash: string;
  kind: AssetKind;
  mime: string;
  ext: string;
  bytes: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  meta: string;
  created_at: number;
};

const toAsset = (r: AssetRow): Asset => ({
  hash: r.hash,
  kind: r.kind,
  mime: r.mime,
  ext: r.ext,
  bytes: r.bytes,
  durationMs: r.duration_ms,
  width: r.width,
  height: r.height,
  meta: parseJson(r.meta, {}),
  createdAt: r.created_at,
});

export function getAsset(hash: string): Asset | undefined {
  if (!/^[a-f0-9]{64}$/.test(hash)) return undefined;
  const r = get<AssetRow>("SELECT * FROM assets WHERE hash = ?", hash);
  return r && toAsset(r);
}

export const assetFile = (a: Pick<Asset, "hash" | "ext">) => mediaPath(a.hash, a.ext);

export type PutOptions = { ext?: string; mime?: string; meta?: Record<string, unknown>; probe?: boolean };

/** 把一个临时文件收进媒体库（移动，不复制）；返回素材记录 */
export async function putFile(tmpPath: string, opts: PutOptions = {}): Promise<Asset> {
  const hash = createHash("sha256");
  const fh = await fs.open(tmpPath, "r");
  const head = new Uint8Array(16);
  await fh.read(head, 0, 16, 0);
  await fh.close();
  await pipeline(createReadStream(tmpPath), hash);
  const digest = hash.digest("hex");

  const sniffed = sniff(head);
  const ext = opts.ext ?? sniffed?.ext ?? "bin";
  const mime = opts.mime ?? sniffed?.mime ?? mimeByExt[ext] ?? "application/octet-stream";

  const existing = getAsset(digest);
  if (existing) {
    await fs.rm(tmpPath, { force: true });
    return existing;
  }

  const dest = mediaPath(digest, ext);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(tmpPath, dest).catch(async (e: NodeJS.ErrnoException) => {
    if (e.code !== "EXDEV") throw e;
    await fs.copyFile(tmpPath, dest);
    await fs.rm(tmpPath, { force: true });
  });
  const stat = await fs.stat(dest);
  const kind = kindOfMime(mime);
  const info = opts.probe !== false && (kind === "audio" || kind === "video" || kind === "image") ? await probe(dest).catch(() => null) : null;

  const asset: Asset = {
    hash: digest,
    kind,
    mime,
    ext,
    bytes: stat.size,
    durationMs: kind === "image" ? null : (info?.durationMs ?? null),
    width: info?.width ?? null,
    height: info?.height ?? null,
    meta: opts.meta ?? {},
    createdAt: Date.now(),
  };
  run(
    "INSERT OR IGNORE INTO assets (hash, kind, mime, ext, bytes, duration_ms, width, height, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    asset.hash,
    asset.kind,
    asset.mime,
    asset.ext,
    asset.bytes,
    asset.durationMs,
    asset.width,
    asset.height,
    json(asset.meta),
    asset.createdAt,
  );
  return getAsset(digest) ?? asset;
}

export async function tempPath(ext = "tmp") {
  await fs.mkdir(tmpDir(), { recursive: true });
  return path.join(tmpDir(), `${randomUUID()}.${ext}`);
}

export async function putBuffer(buf: Uint8Array, opts: PutOptions = {}) {
  const p = await tempPath(opts.ext);
  await fs.writeFile(p, buf);
  return putFile(p, opts);
}

/** 把 Web 流写成临时文件并收进媒体库；超过 maxBytes 时中止 */
export async function putStream(stream: ReadableStream<Uint8Array>, maxBytes: number, opts: PutOptions = {}) {
  const p = await tempPath(opts.ext);
  let size = 0;
  const node = Readable.fromWeb(stream as import("stream/web").ReadableStream<Uint8Array>);
  node.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > maxBytes) node.destroy(new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限`));
  });
  try {
    await pipeline(node, createWriteStream(p));
  } catch (e) {
    await fs.rm(p, { force: true });
    throw e;
  }
  return putFile(p, opts);
}

/** 更新素材的附加信息（合并） */
export function patchAssetMeta(hash: string, meta: Record<string, unknown>) {
  const a = getAsset(hash);
  if (!a) return;
  run("UPDATE assets SET meta = ? WHERE hash = ?", json({ ...a.meta, ...meta }), hash);
}
