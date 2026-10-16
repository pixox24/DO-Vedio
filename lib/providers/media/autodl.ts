import { createWriteStream, promises as fs } from "fs";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import type { MediaRequest, MediaResult } from "../../pipeline/media-gen";
import { PermanentError } from "../../pipeline/stage";
import { getAsset, putFile, sniff, tempPath } from "../../server/media";
import { probe } from "../../server/ffmpeg";
import { get, run as dbRun, tx } from "../../server/db";
import { ledger } from "../../server/cache";
import { getProviderProfile } from "../registry";
import { acquireMediaRecoveryRun, finishGenerationRun, noteGenerationRun, type GenerationRunRow, type MediaRecoveryRun } from "../runs";
import type { MediaRecoveryPhase, MediaRecoveryState } from "../types";
import { longRequest, networkError } from "../http";

export const AUTODL_MODEL_ID = "autodl::minimax_h3_zm_u08";
const WORKFLOW_ID = "minimax_h3_zm_u08";
const MAX_BYTES = 200 * 1024 * 1024;
type Task = { task_id?: string; status?: string; results?: { url?: string; type?: string; file_type?: string; output_type?: string }[] };
type Envelope = { code?: string; msg?: string; data?: Task };

export class AutoDlError extends Error {
  constructor(message: string, public status?: number, public code?: string) { super(message); this.name = "AutoDlError"; }
}
export class SubmissionUnknownError extends PermanentError {
  readonly code = "submission-unknown";
  constructor() { super("AutoDL 提交结果未决：没有任务 ID，不能自动重新提交。请核对服务商任务后再明确重新生成。"); }
}
function aborted(signal: AbortSignal) { signal.throwIfAborted(); }
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason ?? new DOMException("本地等待已停止", "AbortError"));
    const onAbort = () => { clearTimeout(timer); reject(signal.reason ?? new DOMException("本地等待已停止", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** 仅公开工作流支持的字段；参考图是画面参考，不承诺固定首帧。 */
export function autoDlInput(req: MediaRequest, references: string[]) {
  if (req.kind !== "video") throw new PermanentError("AutoDL H3 仅支持视频生成");
  const duration = req.requestDurationSeconds;
  if (!Number.isInteger(duration) || !duration || duration < 1 || duration > 15) throw new PermanentError("AutoDL 视频请求时长必须是 1–15 秒整数");
  if (!req.targetDurationMs || !Number.isFinite(req.targetDurationMs) || req.targetDurationMs <= 0 || req.targetDurationMs > duration * 1000) throw new PermanentError("视频目标时长无效或超过请求时长");
  if (!references.length || references.length > 9) throw new PermanentError("AutoDL H3 需要 1–9 张参考图片");
  if (!req.prompt.trim() || req.prompt.length > 20_000) throw new PermanentError("AutoDL 提示词长度必须是 1–20000 字符");
  const resolution = req.resolution ?? "768p";
  const aspect = req.frame?.aspect ?? "16:9";
  if (!["480p", "768p"].includes(resolution) || !["16:9", "9:16"].includes(aspect)) throw new PermanentError("AutoDL 视频分辨率或画幅不受支持");
  if (req.seed !== undefined && (!Number.isInteger(req.seed) || req.seed < 0 || req.seed > 999999999999999)) throw new PermanentError("AutoDL seed 无效");
  return { prompt: req.prompt, duration, resolution: `${resolution}${aspect === "9:16" ? "竖" : "横"}`, ...Object.fromEntries(references.map((ref, i) => [`ref_image_${i}`, ref])), ...(req.seed === undefined ? {} : { seed: req.seed }) };
}

/** 不实现远端取消；Signal 只终止本地 HTTP 与轮询。 */
export class AutoDlClient {
  private token: string;
  private baseUrl: string;
  readonly pollMs: number;
  constructor(opts: { token?: string; baseUrl?: string; pollMs?: number } = {}) {
    this.token = opts.token ?? process.env.AUTODL_API_TOKEN?.trim() ?? "";
    this.baseUrl = (opts.baseUrl ?? "https://autodl.art/api/v1/comfyui").replace(/\/$/, "");
    this.pollMs = opts.pollMs ?? 3000;
  }
  configured() { if (!this.token) throw new PermanentError("未配置 AUTODL_API_TOKEN"); }
  async request(path: string, method: "GET" | "POST", signal: AbortSignal, body?: Record<string, unknown>): Promise<Task> {
    this.configured();
    const response = await fetch(`${this.baseUrl}/comfyui_workflow/${path}`, { method, headers: { Authorization: this.token, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal, ...longRequest }).catch((e) => { throw networkError(e, "AutoDL 请求"); });
    if (!response.ok) throw new AutoDlError(`AutoDL 请求失败（HTTP ${response.status}）`, response.status, response.status >= 400 && response.status < 500 && response.status !== 408 ? "rejected" : "request-failed");
    const envelope = await response.json() as Envelope;
    if (envelope.code !== "Success" || !envelope.data) throw new AutoDlError(`AutoDL 未接受请求：${envelope.msg || envelope.code || "响应无效"}`, undefined, envelope.code && envelope.code !== "Success" ? "rejected" : "invalid-response");
    return envelope.data;
  }
  submit(body: Record<string, unknown>, signal: AbortSignal) { return this.request(WORKFLOW_ID, "POST", signal, body); }
  query(taskId: string, signal: AbortSignal) { return this.request(`result/${encodeURIComponent(taskId)}`, "GET", signal); }
  async output(taskId: string, signal: AbortSignal): Promise<string> {
    let unknownStatuses = 0;
    while (true) {
      aborted(signal);
      const task = await this.query(taskId, signal);
      const status = task.status?.toUpperCase();
      if (status === "FAILED" || status === "CANCELED" || status === "CANCELLED") throw new AutoDlError(`AutoDL 原任务状态为 ${status}`, undefined, "remote-terminal");
      if (status === "SUCCESS" || status === "COMPLETED") {
        const output = task.results?.find((r) => r.type === "video" && r.file_type === "mp4" && r.output_type !== "temp" && typeof r.url === "string" && /^https?:\/\//i.test(r.url));
        if (!output?.url) throw new AutoDlError("AutoDL 原任务没有返回 MP4 视频", undefined, "empty-output");
        return output.url;
      }
      if (!["QUEUED", "RUNNING", "PENDING", "PROCESSING"].includes(status ?? "")) {
        if (++unknownStatuses >= 3) throw new AutoDlError(`AutoDL 原任务连续返回无法识别的状态：${task.status || "空"}，请稍后恢复原任务`, undefined, "unknown-status");
      } else { unknownStatuses = 0; }
      // 云端排队/执行时间不设总超时；只在明确终态或用户停止时结束，始终查询原任务。
      await delay(this.pollMs, signal);
    }
  }
}

async function downloadVideo(url: string, req: MediaRequest, signal: AbortSignal, runId: string) {
  const response = await fetch(url, { signal, ...longRequest }).catch((e) => { throw networkError(e, "下载 AutoDL 视频"); });
  if (!response.ok) throw new AutoDlError(`下载 AutoDL 视频失败（HTTP ${response.status}）`, response.status, "download-failed");
  if (!response.body) throw new AutoDlError("AutoDL 视频下载结果为空", undefined, "empty-download");
  if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body.cancel(); throw new PermanentError("生成素材超过 200MB 限制"); }
  const file = await tempPath("mp4");
  let size = 0;
  const cap = new Transform({ transform(chunk: Buffer, _encoding, callback) { size += chunk.length; callback(size > MAX_BYTES ? new PermanentError("生成素材超过 200MB 限制") : null, chunk); } });
  try {
    await pipeline(Readable.fromWeb(response.body as import("stream/web").ReadableStream<Uint8Array>), cap, createWriteStream(file), { signal });
    const fh = await fs.open(file, "r");
    const head = Buffer.alloc(16);
    try { await fh.read(head, 0, 16, 0); } finally { await fh.close(); }
    if (!size || sniff(head)?.mime !== "video/mp4") throw new PermanentError("AutoDL 返回的文件不是 MP4 视频");
    const info = await probe(file);
    aborted(signal);
    if (!info.hasVideo || !info.durationMs || !info.width || !info.height) throw new PermanentError("无法读取 AutoDL 视频的实际时长或尺寸");
    if (info.durationMs + 100 < req.targetDurationMs!) throw new PermanentError(`AutoDL 视频实际时长 ${info.durationMs}ms 不足目标 ${req.targetDurationMs}ms`);
    return await putFile(file, { ext: "mp4", mime: "video/mp4", meta: { ...req.meta, source: "autodl", runId, frame: req.frame, fps: info.fps, measuredDurationMs: info.durationMs } });
  } finally { await fs.rm(file, { force: true }); }
}

/** C 自己保存唯一 generation_run；调用方只消费先持久化后的状态回调。 */
export async function generateAutoDlMedia(req: MediaRequest, signal: AbortSignal, dataUri: (hash: string) => Promise<string | undefined>, client = new AutoDlClient()): Promise<MediaResult> {
  const context = req.recovery;
  if (!context?.projectId || !context.attemptId || !context.requestHash || !Number.isInteger(context.candidateIndex) || context.candidateIndex < 0) throw new PermanentError("AutoDL 视频生成缺少可恢复尝试信息");
  const refs = req.references ?? [];
  const input = autoDlInput(req, refs);
  aborted(signal);
  client.configured();
  // 不持久化 token/base64；refs 是素材身份，requestParams 是实际字段及参考索引。
  const profile = getProviderProfile("autodl", WORKFLOW_ID);
  const unitPrice = profile?.price.perSecond;
  const knownPrice = typeof unitPrice === "number" && Number.isFinite(unitPrice) && unitPrice > 0;
  const acquired = acquireMediaRecoveryRun(context, { attemptId: context.attemptId, requestHash: context.requestHash, candidateIndex: context.candidateIndex, shotId: typeof req.meta.shotId === "string" ? req.meta.shotId : undefined, submissionStarted: true, refs, requestParams: input, targetDurationMs: req.targetDurationMs, phase: "submitting", costStatus: knownPrice ? profile?.price.verified === true ? "verified" : "estimated" : "unknown", ...(knownPrice ? { unitPrice } : {}) }, WORKFLOW_ID);
  const run: MediaRecoveryRun = acquired.run;
  const update = async (phase: MediaRecoveryPhase, extra: Record<string, unknown> = {}) => {
    Object.assign(run.params, extra, { phase });
    noteGenerationRun(run.id, { ...extra, phase });
    const state: MediaRecoveryState = { runId: run.id, attemptId: run.params.attemptId, phase, providerTaskId: run.params.taskId, outputUrl: run.params.outputUrl, costStatus: run.params.costStatus };
    await req.onRecovery?.(state);
  };
  const ready = run.outputAssets.filter((hash) => !!getAsset(hash));
  if (ready.length) { await update("ready"); return { assets: ready, runId: run.id }; }
  if (run.params.submissionRejected || run.params.remoteTerminal) { await update("failed"); throw new PermanentError(run.error || "原 AutoDL 尝试已明确失败，请选择重新生成"); }
  if (!acquired.created && !run.params.taskId) { await update("submission-unknown"); throw new SubmissionUnknownError(); }
  try {
    if (acquired.created) {
      // 完整本地资料先准备好，尚未 HTTP 时失败可明确记为未提交。
      let images: string[];
      try {
        images = await Promise.all(refs.map(async (ref) => {
          const uri = await dataUri(ref);
          if (!uri || !/^data:image\/(jpeg|png|webp);base64,/.test(uri)) throw new PermanentError("AutoDL 参考图必须是 JPG/PNG/WebP");
          return uri;
        }));
        aborted(signal);
      } catch (error) { noteGenerationRun(run.id, { submissionRejected: true, submissionStarted: false }); throw error; }
      await update("submitting");
      let task: Task;
      try { task = await client.submit(autoDlInput(req, images), signal); }
      catch (error) {
        if (error instanceof AutoDlError && error.code === "rejected") { await update("failed", { submissionRejected: true }); }
        else { await update("submission-unknown"); throw new SubmissionUnknownError(); }
        throw error;
      }
      if (!task.task_id) { await update("submission-unknown"); throw new SubmissionUnknownError(); }
      // 此处必须先落库；回调异常/取消不会丢失 taskId。
      await update("polling", { taskId: task.task_id });
    } else { await update("polling"); }
    const taskId = run.params.taskId!;
    // 每次恢复都重查原 task，刷新短期 URL；下载403/404/410时也仅刷新此 task。
    let url = await client.output(taskId, signal);
    await update("downloading", { outputUrl: url });
    // 仅明确配置的价格写估算/已核价账本，不把工作流 price:0 当免费。
    if (typeof run.params.unitPrice === "number") tx(() => {
      const row = get<GenerationRunRow>("SELECT * FROM generation_runs WHERE id = ?", run.id)!;
      if (row.ledger_id !== null) return;
      const costYuan = run.params.unitPrice as number * req.requestDurationSeconds!;
      const ledgerId = ledger({ projectId: context.projectId, jobId: row.job_id, provider: "autodl", model: WORKFLOW_ID, unit: "second", quantity: req.requestDurationSeconds!, costYuan });
      // 成功状态留到文件入库；金额与 ledger link 原子保存。
      noteGenerationRun(run.id, { estimatedCostYuan: costYuan });
      // 沿用既有 run 表，没有第二账本。
      dbRun("UPDATE generation_runs SET cost_yuan = ?, ledger_id = ? WHERE id = ?", costYuan, ledgerId, run.id);
    });
    let asset;
    try { asset = await downloadVideo(url, req, signal, run.id); }
    catch (error) {
      if (!(error instanceof AutoDlError) || ![403, 404, 410].includes(error.status ?? 0)) throw error;
      url = await client.output(taskId, signal);
      await update("downloading", { outputUrl: url });
      asset = await downloadVideo(url, req, signal, run.id);
    }
    const row = get<GenerationRunRow>("SELECT * FROM generation_runs WHERE id = ?", run.id)!;
    finishGenerationRun(run.id, { status: "succeeded", latencyMs: Date.now() - run.created_at, outputAssets: [asset.hash], costYuan: row.cost_yuan, ledgerId: row.ledger_id ?? undefined });
    await update("ready", { outputAssetId: asset.hash });
    return { assets: [asset.hash], runId: run.id };
  } catch (error) {
    const remoteTerminal = error instanceof AutoDlError && ["remote-terminal", "empty-output"].includes(error.code ?? "");
    const phase = run.params.phase === "ready" ? "ready" : run.params.phase === "submission-unknown" ? "submission-unknown" : signal.aborted ? "canceled" : "failed";
    // 本地失败仍保留 taskId/output URL；永远不在 catch 中 POST。
    noteGenerationRun(run.id, { phase, ...(remoteTerminal ? { remoteTerminal: true } : {}) });
    const row = get<GenerationRunRow>("SELECT * FROM generation_runs WHERE id = ?", run.id)!;
    if (run.params.phase !== "ready") finishGenerationRun(run.id, { status: signal.aborted ? "canceled" : "failed", latencyMs: Date.now() - run.created_at, outputAssets: JSON.parse(row.output_assets) as string[], costYuan: row.cost_yuan, ledgerId: row.ledger_id ?? undefined, error: error instanceof Error ? error.message : String(error) });
    await update(phase);
    throw error;
  }
}
