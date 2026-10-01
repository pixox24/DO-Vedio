import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { ffmpeg } from "../../server/ffmpeg";
import { pcmToWav, type SynthRequest, type SynthResult, type TtsErrorCode, type TtsModel, type TtsProvider, type TtsUsage, type Voice } from "./types";

export const GEMINI_TTS_FLASH_MODEL = "gemini-3.8-flash-tts";
export const GEMINI_TTS_FLASH_LITE_MODEL = "gemini-3.8-flash-lite-tts";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_API_VERSION = "v1beta";
const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_MAX_TEXT = 10_000;

const voices: Voice[] = [
  { id: "Kore", name: "Kore", gender: "female", style: "清晰、稳重", timestamps: false },
  { id: "Puck", name: "Puck", gender: "male", style: "明快、自然", timestamps: false },
  { id: "Charon", name: "Charon", gender: "male", style: "沉稳、低沉", timestamps: false },
  { id: "Aoede", name: "Aoede", gender: "female", style: "温暖、柔和", timestamps: false },
  { id: "Fenrir", name: "Fenrir", gender: "male", style: "有力、厚实", timestamps: false },
];

export function geminiTtsModels(): TtsModel[] {
  const flash = process.env.GOOGLE_GEMINI_TTS_FLASH_MODEL?.trim() || GEMINI_TTS_FLASH_MODEL;
  const flashLite = process.env.GOOGLE_GEMINI_TTS_FLASH_LITE_MODEL?.trim() || GEMINI_TTS_FLASH_LITE_MODEL;
  return [
    {
      id: flash,
      label: "Gemini 3.8 Flash TTS",
      transport: "http-json",
      capabilities: [],
      limits: { maxTextChars: DEFAULT_MAX_TEXT },
      price: { verified: false, unit: "unknown" },
    },
    {
      id: flashLite,
      label: "Gemini 3.8 Flash-Lite TTS",
      transport: "http-json",
      capabilities: [],
      limits: { maxTextChars: DEFAULT_MAX_TEXT },
      price: { verified: false, unit: "unknown" },
    },
  ];
}

export const GEMINI_TTS_MODELS = geminiTtsModels();

export type GeminiSpeechRequest = {
  text: string;
  stylePrompt?: string;
  model: string;
  voice: string;
  options?: Record<string, unknown>;
};

export type GeminiTtsOptions = {
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  enabled?: boolean;
  maxTextChars?: number;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  sampleRateHertz?: number;
  fetchImpl?: typeof fetch;
  /** 缺省读 GOOGLE_GEMINI_PROXY_URL */
  proxyUrl?: string;
  models?: TtsModel[];
  voices?: Voice[];
};

export class GeminiTtsError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    public readonly code: TtsErrorCode,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GeminiTtsError";
    this.retryable = code === "quota" || code === "rate-limit" || code === "timeout" || code === "upstream";
  }
}

export const GoogleGeminiTtsError = GeminiTtsError;

function textOf(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  for (const key of ["message", "error", "status", "code"]) {
    if (typeof object[key] === "string") return object[key];
    if (object[key] && typeof object[key] === "object") {
      const nested: string = textOf(object[key]);
      if (nested) return nested;
    }
  }
  return "";
}

const networkCauseText: Record<string, string> = {
  ENOTFOUND: "找不到 Gemini 服务地址",
  EAI_AGAIN: "Gemini 域名解析暂时失败",
  ETIMEDOUT: "连接 Gemini 超时",
  ECONNRESET: "Gemini 连接被重置",
  ECONNREFUSED: "Gemini 拒绝连接",
  UND_ERR_CONNECT_TIMEOUT: "连接 Gemini 超时",
  UND_ERR_HEADERS_TIMEOUT: "等待 Gemini 响应超时",
  UND_ERR_BODY_TIMEOUT: "读取 Gemini 响应超时",
  UND_ERR_SOCKET: "Gemini 连接被中断",
};

function causeMessage(cause: unknown) {
  if (!(cause instanceof Error)) return "";
  const code = typeof (cause as Error & { code?: unknown }).code === "string"
    ? (cause as Error & { code: string }).code
    : cause.cause && typeof cause.cause === "object" && typeof (cause.cause as { code?: unknown }).code === "string"
      ? (cause.cause as { code: string }).code
      : undefined;
  return code ? `${networkCauseText[code] ?? "网络连接失败"}（${code}）` : cause.message === "fetch failed" ? "网络连接失败" : cause.message;
}

export function retryAfterMs(value: string | null | undefined, now = Date.now()) {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export function retryAfterMsFromBody(body: unknown) {
  const text = textOf(body) || JSON.stringify(body ?? "");
  const match = text.match(/(?:retry\s+in|retry-after)\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*s/i);
  return match ? retryAfterMs(match[1]) : undefined;
}

export function classifyGeminiError(status?: number, body?: unknown, cause?: unknown, headerRetryAfterMs?: number): GeminiTtsError {
  const message = textOf(body) || causeMessage(cause) || "Gemini TTS 请求失败";
  const lower = `${message} ${JSON.stringify(body ?? "")}`.toLowerCase();
  const retryAfter = Math.max(retryAfterMsFromBody(body) ?? 0, headerRetryAfterMs ?? 0);
  if (/location is not supported|unsupported.?(location|region|country)/.test(lower)) return new GeminiTtsError(`Gemini TTS 不支持当前网络所在地区：请在 .env 配置 GOOGLE_GEMINI_PROXY_URL（例如本机代理 http://127.0.0.1:端口）后重启后台`, "model-unavailable", status, undefined, { cause });
  if (/safety|blocked|harm|prohibited|content.?filter/.test(lower)) return new GeminiTtsError(`Gemini TTS 内容安全拒绝：${message}`, "safety", status, undefined, { cause });
  if (status === 401 || status === 403 || /api.?key|unauthori[sz]|permission|authentication/.test(lower)) return new GeminiTtsError(`Gemini TTS 鉴权失败：${message}`, "auth", status, undefined, { cause });
  if (status === 404 || /model.*(not found|unavailable)|not found/.test(lower)) return new GeminiTtsError(`Gemini TTS 模型不可用：${message}`, "model-unavailable", status, undefined, { cause });
  if (status === 408 || status === 504 || /timeout|timed out|deadline/.test(lower)) return new GeminiTtsError(`Gemini TTS 请求超时：${message}`, "timeout", status, undefined, { cause });
  if (status === 429 && /quota|resource.?exhausted|billing/.test(lower)) return new GeminiTtsError(`Gemini TTS 配额不足：${message}`, "quota", status, retryAfter, { cause });
  if (status === 429 || /rate.?limit|too many requests|throttl/.test(lower)) return new GeminiTtsError(`Gemini TTS 请求过于频繁：${message}`, "rate-limit", status, retryAfter, { cause });
  if (status !== undefined && status >= 400 && status < 500) return new GeminiTtsError(`Gemini TTS 请求无效：${message}`, "invalid-request", status, undefined, { cause });
  return new GeminiTtsError(`Gemini TTS 上游错误：${message}`, "upstream", status, undefined, { cause });
}

type WavInfo = { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number; dataBytes: number; durationMs: number };

function invalidAudio(message: string, cause?: unknown): GeminiTtsError {
  return new GeminiTtsError(`Gemini TTS 音频无效：${message}`, "invalid-audio", undefined, undefined, { cause });
}

function parseWav(audio: Buffer): WavInfo {
  if (audio.length < 12 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") throw invalidAudio("缺少 RIFF/WAVE 文件头");
  const riffSize = audio.readUInt32LE(4);
  if (riffSize + 8 !== audio.length) throw invalidAudio("RIFF 长度与实际文件长度不一致");
  let offset = 12;
  let format: { channels: number; sampleRate: number; bitsPerSample: number; blockAlign: number } | undefined;
  let dataOffset = -1;
  let dataBytes = 0;
  while (offset + 8 <= audio.length) {
    const id = audio.toString("ascii", offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > audio.length) throw invalidAudio(`WAV ${id} 块长度超过实际文件长度`);
    if (id === "fmt " && size >= 16) {
      format = {
        channels: audio.readUInt16LE(start + 2),
        sampleRate: audio.readUInt32LE(start + 4),
        bitsPerSample: audio.readUInt16LE(start + 14),
        blockAlign: audio.readUInt16LE(start + 12),
      };
      if (audio.readUInt16LE(start) !== 1) throw invalidAudio("只支持 PCM WAV");
    }
    if (id === "data") {
      dataOffset = start;
      dataBytes = size;
      break;
    }
    offset = end + (size % 2);
  }
  if (!format || dataOffset < 0) throw invalidAudio("WAV 缺少 fmt 或 data 块");
  if (!format.channels || !format.sampleRate || !format.bitsPerSample || !format.blockAlign || dataBytes % format.blockAlign !== 0) throw invalidAudio("WAV 音频参数或 PCM 长度不一致");
  return { ...format, dataOffset, dataBytes, durationMs: Math.round((dataBytes / (format.sampleRate * format.blockAlign)) * 1000) };
}

export type NormalizedAudio = {
  audio: Buffer;
  mime: "audio/wav";
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationMs: number;
};

export function normalizeAudio(audio: Buffer, mime = "audio/L16", options: { sampleRateHertz?: number; channels?: number; bitsPerSample?: number } = {}): NormalizedAudio {
  const isWav = audio.length >= 12 && audio.toString("ascii", 0, 4) === "RIFF" && audio.toString("ascii", 8, 12) === "WAVE";
  if (isWav) {
    const info = parseWav(audio);
    return { audio, mime: "audio/wav", sampleRate: info.sampleRate, channels: info.channels, bitsPerSample: info.bitsPerSample, durationMs: info.durationMs };
  }
  if (/^audio\/(?:wav|x-wav)(?:;|$)/i.test(mime)) throw invalidAudio("声明为 WAV 的响应缺少 RIFF/WAVE 文件头");
  if (mime && !/^audio\/(?:l16|linear16|pcm|raw|wav|x-wav)(?:;|$)/i.test(mime)) throw invalidAudio(`不支持的音频容器：${mime}`);
  const sampleRate = options.sampleRateHertz ?? DEFAULT_SAMPLE_RATE;
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isInteger(channels) || channels <= 0 || !Number.isInteger(bitsPerSample) || bitsPerSample <= 0 || bitsPerSample % 8 !== 0) throw invalidAudio("裸 PCM 参数无效");
  const frameBytes = channels * (bitsPerSample / 8);
  if (!audio.length || audio.length % frameBytes !== 0) throw invalidAudio("裸 PCM 长度与声道/位深不一致");
  const wav = pcmToWav(audio, sampleRate, channels, bitsPerSample);
  return { audio: wav, mime: "audio/wav", sampleRate, channels, bitsPerSample, durationMs: Math.round((audio.length / (sampleRate * frameBytes)) * 1000) };
}

function hasKnownContainer(audio: Buffer, mime: string) {
  return /audio\/(?:mpeg|mp3|ogg|opus|flac|mp4|aac)/i.test(mime) || audio.toString("ascii", 0, 3) === "ID3" || audio.toString("ascii", 0, 4) === "OggS" || audio.toString("ascii", 0, 4) === "fLaC";
}

async function convertToWav(audio: Buffer, mime: string, signal?: AbortSignal): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-tts-"));
  const input = path.join(dir, "input.audio");
  const output = path.join(dir, "output.wav");
  try {
    await fs.writeFile(input, audio);
    await ffmpeg(["-i", input, "-vn", "-ac", "1", "-c:a", "pcm_s16le", "-f", "wav", output], signal);
    return await fs.readFile(output);
  } catch (error) {
    throw invalidAudio(`无法把 ${mime || "音频"} 转换为 WAV`, error);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function normalizeGeminiAudio(audio: Buffer, mime = "audio/L16", options: { sampleRateHertz?: number; channels?: number; bitsPerSample?: number; signal?: AbortSignal } = {}) {
  try {
    return normalizeAudio(audio, mime, options);
  } catch (error) {
    if (!(error instanceof GeminiTtsError) || error.code !== "invalid-audio" || !hasKnownContainer(audio, mime)) throw error;
    const wav = await convertToWav(audio, mime, options.signal);
    return normalizeAudio(wav, "audio/wav", options);
  }
}

export function buildGeminiRequest(req: GeminiSpeechRequest | SynthRequest) {
  const options = ("providerOptions" in req ? req.providerOptions : "options" in req ? req.options : undefined) ?? {};
  const overrides = options.generationConfig && typeof options.generationConfig === "object" ? options.generationConfig as Record<string, unknown> : {};
  const requestOptions = { ...options };
  delete requestOptions.generationConfig;
  // Gemini TTS currently fixes the generated audio format; generationConfig rejects audioConfig.
  return {
    ...requestOptions,
    contents: [{ role: "user", parts: [{ text: req.text }]}],
    generationConfig: {
      ...overrides,
      responseModalities: ["AUDIO"],
      speechConfig: {
        ...(overrides.speechConfig && typeof overrides.speechConfig === "object" ? overrides.speechConfig as Record<string, unknown> : {}),
        voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice } },
      },
    },
  };
}

type AudioPayload = { data: string; mime: string };

function decodeBase64(value: string): Buffer | undefined {
  const compact = value.replace(/\s/g, "");
  if (!compact || !/^[A-Za-z0-9+/=_-]+$/.test(compact)) return undefined;
  try {
    const decoded = Buffer.from(compact.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return decoded.length ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function findAudio(value: unknown, audioHint = false, inheritedMime = ""): AudioPayload | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAudio(item, audioHint, inheritedMime);
      if (found) return found;
    }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  const mime = typeof object.mimeType === "string" ? object.mimeType : typeof object.mime_type === "string" ? object.mime_type : inheritedMime || (audioHint ? "audio/L16" : "");
  const data = typeof object.data === "string" ? object.data : typeof object.audioData === "string" ? object.audioData : undefined;
  if (data && (audioHint || mime.startsWith("audio/"))) {
    const decoded = decodeBase64(data);
    if (decoded) return { data, mime };
  }
  for (const [key, child] of Object.entries(object)) {
    const keyHint = audioHint || /audio|inlinedata|inline_data|media/i.test(key);
    const found = findAudio(child, keyHint, mime);
    if (found) return found;
  }
  return undefined;
}

function numberAt(value: unknown, keys: string[]): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = numberAt(item, keys);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  for (const key of keys) if (typeof object[key] === "number" && Number.isFinite(object[key])) return object[key] as number;
  for (const child of Object.values(object)) {
    const found = numberAt(child, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function usageFromGeminiResponse(value: unknown, fallbackQuantity = 0): TtsUsage {
  const inputTokens = numberAt(value, ["promptTokenCount", "inputTokenCount", "inputTokens"]);
  const outputTokens = numberAt(value, ["candidatesTokenCount", "outputTokenCount", "outputTokens"]);
  const characters = numberAt(value, ["characters", "characterCount", "billedCharacters"]);
  if (characters !== undefined) return { unit: "characters", quantity: characters, inputTokens, outputTokens, costSource: "provider" };
  if (outputTokens !== undefined) return { unit: "output-tokens", quantity: outputTokens, inputTokens, outputTokens, costSource: "provider" };
  if (inputTokens !== undefined) return { unit: "input-tokens", quantity: inputTokens, inputTokens, outputTokens, costSource: "provider" };
  return { unit: "unknown", quantity: fallbackQuantity, costSource: "unknown" };
}

export function parseGeminiResponse(value: unknown, fallbackQuantity = 0) {
  const audio = findAudio(value);
  if (!audio) throw invalidAudio("响应中没有可用的 Base64 音频");
  return { audio: decodeBase64(audio.data)!, mime: audio.mime, usage: usageFromGeminiResponse(value, fallbackQuantity) };
}

function sleep(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new GeminiTtsError("Gemini TTS 请求已取消", "aborted", 499));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function endpoint(baseUrl: string, apiVersion: string, model: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const version = base.endsWith(`/${apiVersion}`) ? "" : `/${apiVersion}`;
  return `${base}${version}/models/${encodeURIComponent(model)}:generateContent`;
}

async function responseBody(response: Response) {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() || "";
  if (contentType.startsWith("audio/") || contentType === "application/octet-stream") return { contentType, bytes: Buffer.from(await response.arrayBuffer()), json: undefined };
  const raw = await response.text();
  if (!raw.trim()) return { contentType, bytes: undefined, json: undefined };
  try {
    return { contentType, bytes: undefined, json: JSON.parse(raw) as unknown };
  } catch {
    return { contentType, bytes: undefined, json: raw };
  }
}

export function geminiProxyUrl(value = process.env.GOOGLE_GEMINI_PROXY_URL) {
  return value?.trim() || undefined;
}

const proxyAgents = new Map<string, ProxyAgent>();

/**
 * Gemini 专用 fetch：配置了代理就只让 Gemini 请求走代理（Node 内置 fetch 不读系统代理），
 * DashScope 等国内服务商继续直连。
 */
export function geminiFetch(proxyUrl?: string): typeof fetch {
  if (!proxyUrl) return fetch;
  let agent = proxyAgents.get(proxyUrl);
  if (!agent) proxyAgents.set(proxyUrl, (agent = new ProxyAgent(proxyUrl)));
  const dispatcher = agent;
  return (async (input: string | URL, init?: RequestInit) => {
    try {
      return await undiciFetch(input, { ...(init as object), dispatcher } as Parameters<typeof undiciFetch>[1]);
    } catch (error) {
      // 连不上代理本身时，别让用户误以为是 Google 拒绝
      const code = (error as { code?: string; cause?: { code?: string; cause?: { code?: string } } }).code
        ?? (error as { cause?: { code?: string } }).cause?.code
        ?? (error as { cause?: { cause?: { code?: string } } }).cause?.cause?.code;
      if (code === "ECONNREFUSED" || (error instanceof Error && error.message === "fetch failed")) {
        throw new Error(`无法连接 Gemini 代理 ${proxyUrl}，请确认代理软件已启动、端口正确`, { cause: error });
      }
      throw error;
    }
  }) as unknown as typeof fetch;
}

export function isGeminiTtsEnabled(value = process.env.GOOGLE_GEMINI_TTS_ENABLED) {
  return /^(1|true|yes|on)$/i.test(value?.trim() || "");
}

export function geminiApiKey(value?: string) {
  return value?.trim() || process.env.GOOGLE_GEMINI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || undefined;
}

function resolveFactoryArgs(apiKeyOrOptions?: string | GeminiTtsOptions, baseUrl?: string, apiVersion?: string, options?: GeminiTtsOptions): GeminiTtsOptions {
  if (typeof apiKeyOrOptions === "object") return apiKeyOrOptions;
  return { ...(options ?? {}), apiKey: apiKeyOrOptions, baseUrl, apiVersion };
}

export function createGeminiTts(apiKeyOrOptions?: string | GeminiTtsOptions, baseUrl?: string, apiVersion?: string, options?: GeminiTtsOptions): TtsProvider {
  const config = resolveFactoryArgs(apiKeyOrOptions, baseUrl, apiVersion, options);
  const apiKey = geminiApiKey(config.apiKey);
  const apiBase = config.baseUrl ?? process.env.GOOGLE_GEMINI_API_BASE_URL?.trim() ?? DEFAULT_BASE_URL;
  const version = config.apiVersion ?? process.env.GOOGLE_GEMINI_API_VERSION?.trim() ?? DEFAULT_API_VERSION;
  const modelList = config.models ?? geminiTtsModels();
  const voiceList = config.voices ?? voices;
  const maxTextChars = config.maxTextChars ?? (Number(process.env.GOOGLE_GEMINI_TTS_MAX_TEXT_CHARS) || DEFAULT_MAX_TEXT);
  const fetchImpl = config.fetchImpl ?? geminiFetch(config.proxyUrl ?? geminiProxyUrl());

  return {
    id: "google-gemini",
    models: modelList,
    voices: () => voiceList,
    async synthesize(req: SynthRequest, signal?: AbortSignal): Promise<SynthResult> {
      if (!(config.enabled ?? isGeminiTtsEnabled())) throw new GeminiTtsError("Google Gemini TTS 功能开关未开启", "model-unavailable");
      if (!apiKey) throw new GeminiTtsError("未配置 GOOGLE_GEMINI_API_KEY 或 GEMINI_API_KEY，无法配音", "auth");
      if (!req.text.trim() || req.text.length > maxTextChars) throw new GeminiTtsError(`朗读正文长度必须为 1-${maxTextChars} 个字符`, "invalid-request", 400);
      if (!req.model.trim()) throw new GeminiTtsError("Gemini TTS 缺少模型 ID", "invalid-request", 400);
      if (!req.voice.trim()) throw new GeminiTtsError("Gemini TTS 缺少音色 ID", "invalid-request", 400);
      const knownModel = modelList.some((model) => model.id === req.model);
      if (!knownModel && !/^gemini[-_]/i.test(req.model)) throw new GeminiTtsError(`Gemini TTS 模型不可用：${req.model}`, "model-unavailable", 404);
      const body = buildGeminiRequest(req);
      const url = endpoint(apiBase, version, req.model);
      const maxRetries = Math.max(0, config.maxRetries ?? 2);
      const timeoutMs = config.timeoutMs ?? 120_000;
      let response: Response | undefined;
      let parsed: Awaited<ReturnType<typeof responseBody>> | undefined;
      let retryCount = 0;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const timeout = AbortSignal.timeout(timeoutMs);
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        try {
          response = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, body: JSON.stringify(body), signal: requestSignal });
          parsed = await responseBody(response);
        } catch (error) {
          if (signal?.aborted) throw new GeminiTtsError("Gemini TTS 请求已取消", "aborted", 499, undefined, { cause: error });
          if (attempt >= maxRetries) throw classifyGeminiError(undefined, undefined, error);
          retryCount += 1;
          await sleep(config.retryDelayMs ?? 100, signal);
          continue;
        }
        if (response.ok) break;
        const error = classifyGeminiError(response.status, parsed.json, undefined, retryAfterMs(response.headers.get("retry-after")));
        if (!error.retryable || attempt >= maxRetries) throw error;
        const retry = Math.max(error.retryAfterMs ?? 0, Math.min(10_000, (config.retryDelayMs ?? 100) * 2 ** attempt));
        retryCount += 1;
        await sleep(retry > 0 ? retry + Math.floor(Math.random() * 500) : 0, signal);
      }
      if (!response || !parsed || !response.ok) throw classifyGeminiError(response?.status, parsed?.json);
      const fallbackMime = parsed.contentType === "application/octet-stream" ? "audio/L16" : parsed.contentType || "audio/L16";
      const raw = parsed.bytes && parsed.bytes.length ? { audio: parsed.bytes, mime: fallbackMime, usage: usageFromGeminiResponse(undefined, req.text.length) } : parseGeminiResponse(parsed.json, req.text.length);
      const normalized = await normalizeGeminiAudio(raw.audio, raw.mime, { sampleRateHertz: req.output?.sampleRateHertz ?? config.sampleRateHertz, signal });
      const usage = raw.usage;
      return { audio: normalized.audio, mime: "audio/wav", sampleRate: normalized.sampleRate, channels: normalized.channels, bitsPerSample: normalized.bitsPerSample, durationMs: normalized.durationMs, words: [], billedChars: usage.unit === "characters" ? usage.quantity : 0, usage, alignmentSource: "estimated", retryCount };
    },
  };
}

let singleton: TtsProvider | null = null;
export function geminiTts() {
  return (singleton ??= createGeminiTts());
}
