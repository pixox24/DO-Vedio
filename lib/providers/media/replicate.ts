import type { ProviderCapability, ProviderKind } from "../types";

export type ReplicateMediaKind = "image" | "video";

export type ReplicateRequest = {
  prompt: string;
  aspectRatio?: "16:9" | "9:16";
  width?: number;
  height?: number;
  fps?: number;
  referenceImages?: string[];
  seed?: number;
  firstFrame?: string;
  lastFrame?: string;
  controlImage?: string;
};

export type ReplicateResult = {
  outputUrls: string[];
  predictionId: string;
};

export class ReplicateError extends Error {
  constructor(message: string, public status?: number, public code?: string) {
    super(message);
    this.name = "ReplicateError";
  }
}

type Prediction = {
  id?: string;
  status?: string;
  output?: string | string[] | null;
  error?: string | null;
  detail?: string;
};

const env = (name: string) => process.env[name]?.trim() || undefined;
const capabilities: Record<ReplicateMediaKind, readonly ProviderCapability[]> = {
  image: ["reference-image", "character-consistency", "scene-consistency", "seed", "aspect-ratio", "custom-size"],
  video: ["reference-image", "character-consistency", "scene-consistency", "seed", "first-last-frame", "aspect-ratio", "custom-size"],
};

function outputUrls(output: Prediction["output"]) {
  const values = Array.isArray(output) ? output : output ? [output] : [];
  return values.filter((v): v is string => typeof v === "string" && /^https?:\/\//i.test(v));
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("已取消", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), reject(signal.reason ?? new DOMException("已取消", "AbortError"))), { once: true });
  });
}

export class ReplicateMediaAdapter {
  readonly id = "replicate";
  readonly kind: ProviderKind;
  readonly status = "ready" as const;
  private readonly token?: string;
  private readonly version?: string;
  private readonly baseUrl: string;

  constructor(public readonly mediaKind: ReplicateMediaKind, opts: { token?: string; version?: string; baseUrl?: string } = {}) {
    this.kind = mediaKind;
    this.token = opts.token ?? env("REPLICATE_API_TOKEN");
    this.version = opts.version ?? env(mediaKind === "image" ? "REPLICATE_IMAGE_MODEL" : "REPLICATE_VIDEO_MODEL");
    this.baseUrl = (opts.baseUrl ?? env("REPLICATE_BASE_URL") ?? "https://api.replicate.com/v1").replace(/\/$/, "");
  }

  capabilities() {
    return capabilities[this.mediaKind];
  }

  async healthCheck() {
    if (!this.token || !this.version) return { status: "unconfigured" as const, message: "请配置 API Token 和模型版本" };
    return { status: "ready" as const };
  }

  async generate(input: ReplicateRequest, signal?: AbortSignal): Promise<ReplicateResult> {
    if (!this.token) throw new ReplicateError("未配置 REPLICATE_API_TOKEN", 401, "unconfigured");
    if (!this.version) throw new ReplicateError(`未配置 ${this.mediaKind === "image" ? "REPLICATE_IMAGE_MODEL" : "REPLICATE_VIDEO_MODEL"}`, 400, "unconfigured");
    const bodyInput: Record<string, unknown> = { prompt: input.prompt };
    if (input.aspectRatio) bodyInput.aspect_ratio = input.aspectRatio;
    if (input.width) bodyInput.width = input.width;
    if (input.height) bodyInput.height = input.height;
    if (input.fps) bodyInput.fps = input.fps;
    if (input.referenceImages?.length) bodyInput.reference_image = input.referenceImages[0];
    if (input.referenceImages && input.referenceImages.length > 1) bodyInput.reference_images = input.referenceImages;
    if (input.seed !== undefined) bodyInput.seed = input.seed;
    if (input.firstFrame) bodyInput.first_frame = input.firstFrame;
    if (input.lastFrame) bodyInput.last_frame = input.lastFrame;
    if (input.controlImage) bodyInput.control_image = input.controlImage;

    const created = await this.request<Prediction>("/predictions", { method: "POST", body: JSON.stringify({ version: this.version, input: bodyInput }), signal });
    if (!created.id) throw new ReplicateError("Replicate 未返回 prediction id", 502, "invalid_response");
    let prediction = created;
    const deadline = Date.now() + 15 * 60_000;
    while (prediction.status !== "succeeded") {
      if (prediction.status === "failed" || prediction.status === "canceled") throw new ReplicateError(prediction.error || `Replicate 任务${prediction.status}`, 502, prediction.status);
      if (Date.now() > deadline) throw new ReplicateError("Replicate 任务超时", 504, "timeout");
      await wait(1000, signal);
      prediction = await this.request<Prediction>(`/predictions/${encodeURIComponent(created.id)}`, { method: "GET", signal });
    }
    const urls = outputUrls(prediction.output);
    if (!urls.length) throw new ReplicateError("Replicate 没有返回可下载的素材", 502, "empty_output");
    return { outputUrls: urls, predictionId: created.id };
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { Authorization: `Token ${this.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
    } catch (e) {
      throw new ReplicateError(e instanceof Error ? e.message : "Replicate 网络请求失败", 503, "network");
    }
    const raw = await response.text();
    const data = (raw ? JSON.parse(raw) : {}) as T & { detail?: string; error?: string };
    if (!response.ok) throw new ReplicateError(data.detail || data.error || `Replicate 请求失败（HTTP ${response.status}）`, response.status, "http");
    return data;
  }
}

export function replicateImageAdapter() {
  return new ReplicateMediaAdapter("image");
}

export function replicateVideoAdapter() {
  return new ReplicateMediaAdapter("video");
}
