import WebSocket from "ws";
import { billedCharsOf } from "../../pipeline/pricing";
import { transcodeToWav } from "./audio";
import { edgeMuid, generateSecMsGec, invalidateSecMsGec, secMsGec } from "./edge-drm";
import type { SynthRequest, SynthResult, SynthWord, TtsErrorCode, TtsModel, TtsProvider, Voice } from "./types";

/**
 * 微软 Edge 朗读接口（免费、无需 API Key）。全部结论来自实测（2026-10）：
 *
 * - 返回 24kHz / 48kbps / 单声道 MP3，需要 ffmpeg 转成项目统一使用的 WAV；
 * - 返回**词级**时间戳（WordBoundary，100ns 单位），中文按词切分，可直接当字级对齐用；
 * - 语速只认 `+30%` / `-20%` 这种百分比写法，且**只有语速真的生效**：
 *   内置中文音色会把 `pitch` / `volume` 原样忽略，收发自如地拿到逐字节相同的音频；
 * - 不接受 `<break>`、`<mstts:express-as>` 等停顿与情绪标签（回 `SSML is invalid` 后断开），
 *   所以外壳固定，正文只能是不含标签的纯文本；
 * - 需要 `Sec-MS-GEC` 令牌（微软 DRM v2），算法见 `edge-drm.ts`；令牌算错只会得到 403。
 *
 * 验证方式：`node --import tsx scripts/tts-probe.ts --models=edge-tts --variants --extended`
 * （不要走 `npm run`，npm 会把 `--models=` 丢掉，跑成全部模型）。
 *
 * 这是对 Edge 内置朗读功能的逆向调用，不是微软公开 API：协议变更时配音会整体失效。
 */

const WSS_URL = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
/** 上游按此版本号伪装 Edge，微软会校验版本格式 */
const SEC_MS_GEC_VERSION = "2-143.0.3650.75";
const SEC_MS_GEC_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const SEC_MS_GEC_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const SAMPLE_RATE = 24_000;
/** MP3 是 48kbps CBR，可按字节精确换算时长 */
const MP3_BYTES_PER_SECOND = 6_000;
const TICKS_PER_MS = 10_000;
const DEFAULT_MODEL = "edge-tts";
/** 单次请求的上限：超过就先分块（项目默认 300 字一块，实测 2700 字一次也没问题） */
const DEFAULT_MAX_TEXT_CHARS = 5_000;
/** 实测合成耗时约为音频时长的 1/10，这里按「时长 + 余量」给足 */
const MIN_TIMEOUT_MS = 60_000;
const AUDIO_TIME_FACTOR = 0.35;

type Gender = Voice["gender"];

/** 内置音色：中文为主（语音库共 322 个音色，不内置全部）；用 EDGE_TTS_VOICES 追加其他语种 */
const BUILTIN_VOICES: readonly Voice[] = [
  { id: "zh-CN-XiaoxiaoNeural", name: "晓晓 · 温暖", gender: "female", style: "温暖自然女声，适合口播与新闻", timestamps: true },
  { id: "zh-CN-XiaoyiNeural", name: "晓伊 · 活泼", gender: "female", style: "活泼少女声", timestamps: true },
  { id: "zh-CN-YunxiNeural", name: "云希 · 阳光", gender: "male", style: "阳光青年男声", timestamps: true },
  { id: "zh-CN-YunyangNeural", name: "云扬 · 专业", gender: "male", style: "专业播报男声，适合新闻", timestamps: true },
  { id: "zh-CN-YunjianNeural", name: "云健 · 激情", gender: "male", style: "激情解说男声，适合体育", timestamps: true },
  { id: "zh-CN-YunxiaNeural", name: "云夏 · 少年", gender: "male", style: "少年音，适合动画解说", timestamps: true },
  { id: "zh-CN-liaoning-XiaobeiNeural", name: "晓北 · 东北", gender: "female", style: "东北口音女声，适合搞笑", timestamps: true },
  { id: "zh-CN-shaanxi-XiaoniNeural", name: "晓妮 · 陕西", gender: "female", style: "中原官话女声", timestamps: true },
  { id: "zh-HK-HiuMaanNeural", name: "曉曼 · 粤语", gender: "female", style: "粤语女声", timestamps: true },
  { id: "zh-HK-WanLungNeural", name: "雲龍 · 粤语", gender: "male", style: "粤语男声", timestamps: true },
  { id: "zh-HK-HiuGaaiNeural", name: "曉佳 · 粤语", gender: "female", style: "粤语女声", timestamps: true },
  { id: "zh-TW-HsiaoChenNeural", name: "曉臻 · 台湾", gender: "female", style: "台湾国语女声", timestamps: true },
  { id: "zh-TW-HsiaoYuNeural", name: "曉雨 · 台湾", gender: "female", style: "台湾国语女声", timestamps: true },
  { id: "zh-TW-YunJheNeural", name: "雲哲 · 台湾", gender: "male", style: "台湾国语男声", timestamps: true },
];

export type EdgeTtsOptions = {
  voices?: Voice[];
  maxTextChars?: number;
  timeoutMs?: number;
  /** 缺省读 EDGE_TTS_WSS_URL，便于自建代理或微软换域名时改指向 */
  url?: string;
};

export class EdgeTtsError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    public readonly code: TtsErrorCode,
    public readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "EdgeTtsError";
    this.retryable = code === "rate-limit" || code === "timeout" || code === "upstream";
  }
}

export function edgeTtsModels(): TtsModel[] {
  const id = process.env.EDGE_TTS_MODEL?.trim() || DEFAULT_MODEL;
  return [
    {
      id,
      label: "Edge 朗读（免费）",
      transport: "websocket",
      capabilities: ["word-timestamps", "wav", "numeric-rate", "numeric-pitch", "numeric-volume"],
      limits: { maxTextChars: edgeMaxTextChars() },
      price: { verified: true, perTenThousandChars: 0 },
    },
  ];
}

const edgeMaxTextChars = () => Number(process.env.EDGE_TTS_MAX_TEXT_CHARS) || DEFAULT_MAX_TEXT_CHARS;

export function edgeTtsVoices(): Voice[] {
  const extra = (process.env.EDGE_TTS_VOICES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, ...rest] = entry.split(":");
      return { id: id.trim(), name: rest.join(":").trim() || id.trim(), gender: "female" as Gender, style: "自定义音色", timestamps: true };
    })
    .filter((voice) => voice.id);
  const seen = new Set(BUILTIN_VOICES.map((voice) => voice.id));
  return [...BUILTIN_VOICES, ...extra.filter((voice) => !seen.has(voice.id))];
}

/**
 * 项目用倍率/整数表达音色参数，Edge 只认 `+10%`、`-20Hz` 这类带符号写法。
 *
 * 实测（2026-10）：内置中文音色只认 `rate`——把 `pitch` / `volume` 原样发过去会拿到
 * **逐字节相同**的音频（换成 en-US 的 Multilingual 音色才生效）。所以这里只发 rate：
 * 音量滑块的换算改由 ffmpeg 线性增益实现（`edgeGainDb`），音调对内置音色无效、面板里已禁用。
 */
export function edgeProsody(voice: Pick<SynthRequest, "rate">) {
  const rate = voice.rate === undefined ? 0 : (voice.rate - 1) * 100;
  return { rate: `${rate >= 0 ? "+" : "-"}${Math.abs(Math.round(rate))}%` };
}

/** 音量滑块 0–100（50 为原声）→ 线性增益 dB；上限 ±20dB，免得把底噪一起放大 */
export function edgeGainDb(volume: number | undefined) {
  if (volume === undefined) return 0;
  const gain = ((volume - 50) / 50) * 20;
  return Math.round(Math.max(-20, Math.min(20, gain)) * 10) / 10;
}

/** 朗读接口不接受任何标签与部分控制字符，正文必须清洗后再塞进固定外壳 */
export function edgePlainText(text: string) {
  let out = "";
  for (const char of text) out += /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(char) ? " " : char;
  return out
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;")
    .replaceAll('"', "&quot;");
}

export function edgeSsml(text: string, voice: string, prosody: ReturnType<typeof edgeProsody>) {
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${voice}'>` +
    `<prosody pitch='+0Hz' rate='${prosody.rate}' volume='+0%'>` +
    `${edgePlainText(text)}` +
    "</prosody></voice></speak>"
  );
}

const stamp = () => new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");

export function edgeConnectionUrl({
  url = process.env.EDGE_TTS_WSS_URL?.trim() || WSS_URL,
  connectionId,
  token,
  version = SEC_MS_GEC_VERSION,
}: { url?: string; connectionId: string; token: string; version?: string }) {
  return (
    `${url}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}` +
    `&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=${version}`
  );
}

export function edgeHeaders(muid = edgeMuid()) {
  return {
    "User-Agent": SEC_MS_GEC_USER_AGENT,
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-Language": "en-US,en;q=0.9",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Origin: SEC_MS_GEC_ORIGIN,
    "Sec-WebSocket-Version": "13",
    Cookie: `muid=${muid};`,
  };
}

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const unescapeXml = (value: string) => value.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity);

/** 一帧 binary 消息：2 字节头长度 + 头 + 音频 */
function binaryFrame(data: Buffer) {
  if (data.length < 2) return undefined;
  const headerLength = data.readUInt16BE(0);
  if (2 + headerLength > data.length) return undefined;
  const path = /Path:([^\r\n]+)/.exec(data.toString("latin1", 2, 2 + headerLength))?.[1];
  const body = data.subarray(2 + headerLength + (data.toString("latin1", 2 + headerLength, 2 + headerLength + 2) === "\r\n" ? 2 : 0));
  return { path, body };
}

export type EdgeMetadata = { type: string; offset: number; duration: number; text: string };

/** 文本帧：`头\r\n\r\n体`。audio.metadata 里是词边界 JSON。 */
export function parseEdgeMetadata(text: string): EdgeMetadata[] {
  const split = text.indexOf("\r\n\r\n");
  if (split < 0 || !/Path:audio\.metadata/.test(text.slice(0, split))) return [];
  try {
    const body = JSON.parse(text.slice(split + 4)) as { Metadata?: { Type?: string; Data?: { Offset?: number; Duration?: number; text?: { Text?: string } } }[] };
    return (body.Metadata ?? [])
      .filter((entry) => entry.Type === "WordBoundary" && entry.Data)
      .map((entry) => ({
        type: entry.Type!,
        offset: Number(entry.Data!.Offset ?? 0),
        duration: Number(entry.Data!.Duration ?? 0),
        text: unescapeXml(String(entry.Data!.text?.Text ?? "")),
      }));
  } catch {
    return [];
  }
}

/** 100ns 单位 → 项目统一的毫秒词表（合并同一起点的重复上报） */
export function wordsFromEdgeMetadata(metadata: readonly EdgeMetadata[]): SynthWord[] {
  const words: SynthWord[] = [];
  for (const item of metadata) {
    const startMs = Math.round(item.offset / TICKS_PER_MS);
    const endMs = Math.round((item.offset + item.duration) / TICKS_PER_MS);
    if (!item.text.trim() || endMs <= startMs) continue;
    const previous = words[words.length - 1];
    if (previous && previous.startMs === startMs) previous.endMs = Math.max(previous.endMs, endMs);
    else words.push({ text: item.text, startMs, endMs });
  }
  return words;
}

function classify(status: number | undefined, detail: string, cause?: unknown): EdgeTtsError {
  const text = detail.trim().slice(0, 300);
  if (status === 403) {
    return new EdgeTtsError(
      `Edge 朗读拒绝了请求（HTTP 403）：可能是微软改动了鉴权或本机时钟偏差。同步系统时间后重试；若持续失败说明上游协议已变更。${text}`,
      "auth",
      status,
      { cause },
    );
  }
  if (status === 429) return new EdgeTtsError(`Edge 朗读请求过于频繁（HTTP 429）：${text}`, "rate-limit", status, { cause });
  if (status !== undefined && status >= 500) return new EdgeTtsError(`Edge 朗读服务端错误（HTTP ${status}）：${text}`, "upstream", status, { cause });
  if (/SSML is invalid/i.test(text)) {
    return new EdgeTtsError("Edge 朗读不接受这段 SSML：它只支持纯文本正文，不支持 <break> 等停顿或情绪标签", "invalid-request", 400, { cause });
  }
  if (status !== undefined && status >= 400) return new EdgeTtsError(`Edge 朗读请求失败（HTTP ${status}）：${text}`, "invalid-request", status, { cause });
  if (cause instanceof EdgeTtsError) return cause;
  return new EdgeTtsError(`Edge 朗读连接失败：${text || (cause instanceof Error ? cause.message : "未知错误")}`, "upstream", status, { cause });
}

type Connection = { audio: Buffer; metadata: EdgeMetadata[]; serverDate?: string };

function openConnection(url: string, ssml: string, timeoutMs: number, signal?: AbortSignal): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const metadata: EdgeMetadata[] = [];
    let settled = false;
    const ws = new WebSocket(url, { headers: edgeHeaders() });
    const done = (error?: Error, value?: Connection) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      try {
        ws.close();
      } catch {}
      if (error) reject(error);
      else resolve(value!);
    };
    const onAbort = () => {
      ws.terminate();
      done(new EdgeTtsError("Edge 朗读请求已取消", "aborted", 499));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      ws.terminate();
      done(new EdgeTtsError(`Edge 朗读超时（${Math.round(timeoutMs / 1000)} 秒）`, "timeout", 504));
    }, timeoutMs);

    ws.on("unexpected-response", (_request, response) => {
      let body = "";
      response.on("data", (chunk: Buffer) => (body += chunk.toString()));
      response.on("end", () => {
        const error = classify(response.statusCode, body);
        done(new EdgeTtsError(error.message, error.code, error.status, { cause: { serverDate: response.headers.date } }));
      });
    });
    ws.on("open", () => {
      ws.send(
        `X-Timestamp:${stamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},` +
          `"outputFormat":"${OUTPUT_FORMAT}"}}}}\r\n`,
      );
      ws.send(`X-RequestId:${edgeMuid().toLowerCase()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp()}Z\r\nPath:ssml\r\n\r\n${ssml}`);
    });
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        const frame = binaryFrame(data);
        if (frame?.path === "audio" && frame.body.length) chunks.push(frame.body);
        return;
      }
      const text = String(data);
      const split = text.indexOf("\r\n\r\n");
      const path = split >= 0 ? /Path:([^\r\n]+)/.exec(text.slice(0, split))?.[1] : undefined;
      if (path === "audio.metadata") metadata.push(...parseEdgeMetadata(text));
      else if (path === "turn.end") {
        const audio = Buffer.concat(chunks);
        if (!audio.length) done(new EdgeTtsError("Edge 朗读没有返回音频", "invalid-audio", 502));
        else done(undefined, { audio, metadata });
      }
    });
    ws.on("error", (error) => done(new EdgeTtsError(`Edge 朗读连接出错：${error.message}`, "upstream", 503, { cause: error })));
    ws.on("close", (code, reason) => {
      if (code === 1007) done(new EdgeTtsError(`Edge 朗读拒绝了请求内容：${String(reason) || "SSML is invalid"}`, "invalid-request", 400));
      else done(new EdgeTtsError(`Edge 朗读连接意外关闭（${code} ${String(reason).slice(0, 80)}）`, "upstream", 503));
    });
  });
}

function timeoutFor(text: string, configured?: number) {
  const estimate = (text.length / 4.5) * 1000 * AUDIO_TIME_FACTOR + 20_000;
  const fromEnv = Number(process.env.EDGE_TTS_TIMEOUT_MS) || 0;
  return Math.max(configured ?? fromEnv, MIN_TIMEOUT_MS, Math.round(estimate));
}

export function createEdgeTts(options: EdgeTtsOptions = {}): TtsProvider {
  const models = edgeTtsModels();
  const voices = options.voices ?? edgeTtsVoices();
  const maxTextChars = options.maxTextChars ?? edgeMaxTextChars();
  const url = options.url ?? (process.env.EDGE_TTS_WSS_URL?.trim() || WSS_URL);

  return {
    id: "edge",
    models,
    voices: () => voices,
    async synthesize(req: SynthRequest, signal?: AbortSignal): Promise<SynthResult> {
      const text = req.text.trim();
      if (!text) throw new EdgeTtsError("朗读正文不能为空", "invalid-request", 400);
      if (text.length > maxTextChars) {
        throw new EdgeTtsError(`Edge 朗读单次最多 ${maxTextChars} 字（当前 ${text.length} 字），请先分块`, "invalid-request", 400);
      }
      if (!req.model.trim()) throw new EdgeTtsError("Edge 朗读缺少模型 ID", "invalid-request", 400);
      if (!req.voice.trim()) throw new EdgeTtsError("Edge 朗读缺少音色 ID", "invalid-request", 400);
      if (req.textType === "SSML" || /<[a-zA-Z/]/.test(text)) {
        throw new EdgeTtsError("Edge 朗读只接受纯文本，不支持 SSML 与停顿标签", "invalid-request", 400);
      }

      const ssml = edgeSsml(text, req.voice, edgeProsody(req));
      const timeoutMs = timeoutFor(text, options.timeoutMs);
      let connection: Connection;
      try {
        connection = await openConnection(edgeConnectionUrl({ url, connectionId: edgeMuid().toLowerCase(), token: secMsGec() }), ssml, timeoutMs, signal);
      } catch (error) {
        // 令牌按本机时间取整，时钟偏差会得到 403；同步一次服务端时间后只用新令牌重试
        if (!(error instanceof EdgeTtsError) || error.status !== 403) throw error;
        const serverDate = (error.cause as { serverDate?: string } | undefined)?.serverDate;
        const skewMs = serverDate ? Date.parse(serverDate) - Date.now() : 0;
        if (!Number.isFinite(skewMs) || Math.abs(skewMs) < 5_000) throw error;
        invalidateSecMsGec();
        connection = await openConnection(
          edgeConnectionUrl({ url, connectionId: edgeMuid().toLowerCase(), token: generateSecMsGec((Date.now() + skewMs) / 1000) }),
          ssml,
          timeoutMs,
          signal,
        );
      }

      const words = wordsFromEdgeMetadata(connection.metadata);
      const approximatedMs = Math.round((connection.audio.length / MP3_BYTES_PER_SECOND) * 1000);
      const durationMs = Math.max(approximatedMs, words.at(-1)?.endMs ?? 0);
      const wav = await transcodeToWav(connection.audio, "audio/mpeg", { sampleRate: SAMPLE_RATE, gainDb: edgeGainDb(req.volume), signal });
      const quantity = billedCharsOf(text);
      return {
        audio: wav,
        mime: "audio/wav",
        sampleRate: SAMPLE_RATE,
        channels: 1,
        durationMs,
        words,
        billedChars: quantity,
        usage: { unit: "characters", quantity, costSource: "provider" },
        alignmentSource: words.length ? "provider" : "estimated",
        retryCount: 0,
      };
    },
  };
}

let singleton: TtsProvider | null = null;
export function edgeTts() {
  return (singleton ??= createEdgeTts());
}
