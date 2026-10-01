export const providerKinds = ["text", "image", "video", "tts", "align", "lipsync"] as const;
export type ProviderKind = (typeof providerKinds)[number];

export const providerInterfaceTypes = ["openai-compatible", "anthropic"] as const;
export type ProviderInterfaceType = (typeof providerInterfaceTypes)[number];

export const adapterStatuses = ["ready", "planned"] as const;
export type AdapterStatus = (typeof adapterStatuses)[number];

export type ProviderCapability =
  | "stream"
  | "structured-output"
  | "reference-image"
  | "character-consistency"
  | "scene-consistency"
  | "seed"
  | "first-last-frame"
  | "word-timestamps"
  | "instruct"
  | "ssml"
  | "emotion-tags"
  | "style-prompt"
  | "multi-speaker"
  | "sentence-timestamps"
  | "raw-pcm"
  | "wav"
  | "numeric-rate"
  | "numeric-pitch"
  | "numeric-volume"
  | "forced-alignment"
  | "lip-sync"
  /** 文本模型可联网搜索（如通义千问 enable_search） */
  | "web-search"
  /** 生图服务商可直接接受目标画幅 */
  | "aspect-ratio"
  /** 生图服务商可接受明确宽高 */
  | "custom-size";

export type ProviderProfile = {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  kind: ProviderKind;
  adapter: string;
  adapterStatus: AdapterStatus;
  capabilities: ProviderCapability[];
  configured: boolean;
  enabled: boolean;
  authEnv?: string;
  baseUrl?: string;
  price: Record<string, number | boolean | string>;
  defaults: Record<string, unknown>;
  limits: Record<string, number | string>;
  interfaceType?: ProviderInterfaceType;
  custom?: boolean;
};

export type ModelProfileOverride = {
  providerId: string;
  modelId: string;
  enabled?: boolean;
  price?: Record<string, number | boolean | string>;
  defaults?: Record<string, unknown>;
  limits?: Record<string, number | string>;
};

export type GenerationKind = ProviderKind;
export type GenerationStatus = "running" | "succeeded" | "failed" | "canceled";

export type AdapterHealth = {
  status: "ready" | "unconfigured" | "error";
  message?: string;
};

export type TextGenerationRequest = {
  model: string;
  instructions?: string;
  prompt: string;
  signal?: AbortSignal;
};

export type TextGenerationResult = {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type ImageGenerationRequest = {
  model: string;
  prompt: string;
  referenceImages?: string[];
  seed?: number;
  signal?: AbortSignal;
};

export type VideoGenerationRequest = ImageGenerationRequest & {
  durationMs?: number;
  firstFrame?: string;
  lastFrame?: string;
};

export type MediaGenerationResult = {
  assetIds: string[];
  metadata?: Record<string, unknown>;
};

/**
 * 供应商适配器的最小合约。Phase A 只定义边界，具体 SDK/HTTP 实现按能力接入。
 * API Key、请求重试和供应商特有参数都应留在适配器内部。
 */
export interface ProviderAdapter {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly status: AdapterStatus;
  capabilities(): readonly ProviderCapability[];
  healthCheck(): Promise<AdapterHealth>;
}

export interface TextProviderAdapter extends ProviderAdapter {
  readonly kind: "text";
  generate(request: TextGenerationRequest): Promise<TextGenerationResult>;
}

export interface ImageProviderAdapter extends ProviderAdapter {
  readonly kind: "image";
  generate(request: ImageGenerationRequest): Promise<MediaGenerationResult>;
}

export interface VideoProviderAdapter extends ProviderAdapter {
  readonly kind: "video";
  generate(request: VideoGenerationRequest): Promise<MediaGenerationResult>;
}

export type TtsGenerationRequest = {
  model: string;
  voice: string;
  text: string;
  signal?: AbortSignal;
};

export interface TtsProviderAdapter extends ProviderAdapter {
  readonly kind: "tts";
  synthesize(request: TtsGenerationRequest): Promise<MediaGenerationResult>;
}
