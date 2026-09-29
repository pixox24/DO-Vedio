import { randomUUID } from "crypto";
import { createReadStream, promises as fs } from "fs";
import http from "http";
import path from "path";
import type { AddressInfo } from "net";
import { quickHash } from "../core/hash";
import { toSrt } from "../core/subtitles";
import type { Timeline } from "../core/timeline";
import { dataDir, get, run } from "../server/db";
import { ffmpeg, loudnormFilter, measureLoudness } from "../server/ffmpeg";
import { assetFile, getAsset, putBuffer, putFile, tempPath } from "../server/media";

/**
 * 渲染：Remotion 出画面和混音 → FFmpeg 响度归一 + 写入 AIGC 隐式标识 → 成片和 SRT 入库。
 * Remotion 相关模块较重，只在 Worker 里按需加载。
 */

// ---------- 打包缓存 ----------

async function hashDir(dir: string): Promise<string> {
  const parts: string[] = [];
  const walk = async (d: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(tsx?|json)$/.test(e.name)) parts.push(`${path.relative(dir, p)}:${(await fs.stat(p)).mtimeMs}`);
    }
  };
  await walk(dir);
  return quickHash(parts.sort());
}

let bundling: Promise<string> | null = null;
let bundled: { sig: string; url: string } | null = null;

/** Remotion 打包（按源码签名缓存）；源码包括 remotion/ 和 lib/core/ */
export async function getBundle(onProgress?: (p: number) => void): Promise<string> {
  const root = process.cwd();
  const sig = quickHash([await hashDir(path.join(root, "remotion")), await hashDir(path.join(root, "lib/core"))]);
  if (bundled?.sig === sig) return bundled.url;
  const outDir = path.join(dataDir(), "bundles", sig);
  if (await fs.stat(path.join(outDir, "index.html")).catch(() => null)) {
    bundled = { sig, url: outDir };
    return outDir;
  }
  bundling ??= (async () => {
    const { bundle } = await import("@remotion/bundler");
    const url = await bundle({
      entryPoint: path.join(root, "remotion/index.ts"),
      outDir,
      publicDir: path.join(root, "public"),
      onProgress: (p) => onProgress?.(p / 100),
      webpackOverride: (config) => ({
        ...config,
        resolve: { ...config.resolve, alias: { ...(config.resolve?.alias as object), "@": root } },
      }),
    });
    bundled = { sig, url };
    return url;
  })().finally(() => {
    bundling = null;
  });
  return bundling;
}

// ---------- 本地素材服务（供无头浏览器加载） ----------

type MediaServer = { origin: string; close: () => Promise<void> };

/** 只读、只监听 127.0.0.1、只按哈希提供已入库的素材；支持 Range */
export async function startMediaServer(): Promise<MediaServer> {
  const server = http.createServer(async (req, res) => {
    const hash = req.url?.match(/^\/([a-f0-9]{64})/)?.[1];
    const asset = hash && getAsset(hash);
    if (!asset) {
      res.writeHead(404).end();
      return;
    }
    const file = assetFile(asset);
    const size = (await fs.stat(file).catch(() => null))?.size;
    if (size === undefined) {
      res.writeHead(404).end();
      return;
    }
    const headers = { "Content-Type": asset.mime, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=31536000" };
    const m = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, "Content-Length": size });
      if (req.method === "HEAD") res.end();
      else createReadStream(file).pipe(res);
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

// ---------- 渲染 ----------

export type Quality = "draft" | "final";

export type RenderOutput = { renderId: string; videoHash: string; srtHash: string | null; durationMs: number; loudness: number };

export async function renderTimeline(opts: {
  projectId: string;
  timeline: Timeline;
  timelineHash: string;
  quality: Quality;
  signal: AbortSignal;
  current: () => boolean;
  progress: (p: number, msg: string) => void;
}): Promise<RenderOutput> {
  const { timeline: t, quality } = opts;
  const existing = get<{ id: string; video_hash: string; srt_hash: string | null; duration_ms: number; loudness: number }>(
    "SELECT * FROM renders WHERE project_id = ? AND timeline_hash = ? AND quality = ? ORDER BY created_at DESC LIMIT 1",
    opts.projectId,
    opts.timelineHash,
    quality,
  );
  if (existing && getAsset(existing.video_hash)) {
    return { renderId: existing.id, videoHash: existing.video_hash, srtHash: existing.srt_hash, durationMs: existing.duration_ms, loudness: existing.loudness };
  }

  const { renderMedia, selectComposition, makeCancelSignal, ensureBrowser } = await import("@remotion/renderer");
  opts.progress(0.01, "准备浏览器");
  await ensureBrowser();
  opts.progress(0.02, "打包合成代码");
  const serveUrl = await getBundle((p) => opts.progress(0.02 + p * 0.06, "打包合成代码"));

  const server = await startMediaServer();
  const { cancelSignal, cancel } = makeCancelSignal();
  const onAbort = () => cancel();
  opts.signal.addEventListener("abort", onAbort, { once: true });
  const raw = await tempPath("mp4");
  try {
    // 素材地址改成本地服务
    const local = JSON.parse(JSON.stringify(t).replaceAll("/api/media/", `${server.origin}/`)) as Timeline;
    const inputProps = { timeline: local };
    const composition = await selectComposition({ serveUrl, id: "Main", inputProps });
    const licenseKey = process.env.REMOTION_LICENSE_KEY?.trim();
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      codec: "h264",
      outputLocation: raw,
      crf: quality === "final" ? 18 : 28,
      scale: quality === "final" ? 1 : 0.5,
      x264Preset: quality === "final" ? "medium" : "veryfast",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      audioBitrate: "192k",
      imageFormat: "jpeg",
      jpegQuality: quality === "final" ? 92 : 75,
      enforceAudioTrack: true,
      concurrency: Number(process.env.RENDER_CONCURRENCY) || null,
      cancelSignal,
      timeoutInMilliseconds: 120_000,
      chromiumOptions: { gl: "angle" },
      logLevel: "warn",
      ...(licenseKey ? { licenseKey } : {}),
      onProgress: ({ progress, stitchStage }) => opts.progress(0.08 + progress * 0.8, stitchStage === "muxing" ? "封装中" : `渲染 ${Math.round(progress * 100)}%`),
    });
  } finally {
    opts.signal.removeEventListener("abort", onAbort);
    await server.close();
  }
  if (!opts.current()) throw opts.signal.reason ?? new DOMException("渲染任务已取消", "AbortError");

  // 响度归一 + 隐式标识（视频流直接复制）
  opts.progress(0.9, "响度归一");
  const target = { i: -14, tp: -1, lra: 11 };
  const m = await measureLoudness(raw, target, opts.signal);
  const out = await tempPath("mp4");
  const renderId = randomUUID();
  const aigc = JSON.stringify({ Label: "1", ContentProducer: "DO-Vedio", ProduceID: renderId, ReservedCode1: "", ContentPropagator: "", PropagateID: "", ReservedCode2: "" });
  await ffmpeg(
    [
      "-i",
      raw,
      "-map",
      "0",
      "-c:v",
      "copy",
      "-af",
      `${loudnormFilter(m, target)},aresample=48000`,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-metadata",
      `title=${t.title}`,
      "-metadata",
      `comment=AIGC ${aigc}`,
      "-metadata",
      `AIGC=${aigc}`,
      "-movflags",
      "+faststart+use_metadata_tags",
      out,
    ],
    opts.signal,
  );
  await fs.rm(raw, { force: true });
  const after = await measureLoudness(out, target, opts.signal).catch(() => null);
  if (!opts.current()) throw opts.signal.reason ?? new DOMException("渲染任务已取消", "AbortError");

  opts.progress(0.97, "保存成片");
  const video = await putFile(out, { ext: "mp4", mime: "video/mp4", meta: { source: "render", projectId: opts.projectId, aspect: t.aspect, quality, aigc: true } });
  const srt = t.cues.length ? await putBuffer(Buffer.from(toSrt(t.cues), "utf8"), { ext: "srt", mime: "application/x-subrip", probe: false, meta: { source: "render" } }) : null;
  if (!opts.current()) throw opts.signal.reason ?? new DOMException("渲染任务已取消", "AbortError");
  const loudness = after?.i ?? m.i;
  run(
    "INSERT INTO renders (id, project_id, aspect, quality, timeline_hash, video_hash, srt_hash, duration_ms, loudness, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    renderId,
    opts.projectId,
    t.aspect,
    quality,
    opts.timelineHash,
    video.hash,
    srt?.hash ?? null,
    t.durationMs,
    loudness,
    Date.now(),
  );
  return { renderId, videoHash: video.hash, srtHash: srt?.hash ?? null, durationMs: t.durationMs, loudness };
}
