import { randomUUID } from "crypto";
import WebSocket from "ws";
import { PermanentError } from "../../pipeline/stage";
import { pcmToWav, type SynthRequest, type SynthResult, type SynthWord, type TtsProvider, type TtsModel, type Voice } from "./types";

/**
 * 阿里云百炼 CosyVoice（WebSocket 双工协议）。
 * 已实测（2026-09）：cosyvoice-v3-flash 下列音色都会返回字级时间戳；SSML 暂不支持，读音靠同音字替换。
 * 音色描述仅供参考，请在设置里试听。
 */

const URL_DEFAULT = "wss://dashscope.aliyuncs.com/api-ws/v1/inference/";
const SAMPLE_RATE = 24000;
const HTTP_TTS_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer";
const QWEN_AUDIO_MODELS = new Set(["qwen-audio-3.0-tts-plus", "qwen-audio-3.0-tts-flash", "qwen-audio-3.1-tts-flash"]);

const v3Voices: Voice[] = [
  { id: "longanyang", name: "龙安洋", gender: "male", style: "阳光青年男声", timestamps: true },
  { id: "longanhuan", name: "龙安欢", gender: "female", style: "欢快元气女声", timestamps: true },
  { id: "longshu_v3", name: "龙书", gender: "male", style: "沉稳叙述男声", timestamps: true },
  { id: "longsanshu_v3", name: "龙三叔", gender: "male", style: "沉稳质感男声，适合悬疑、纪录片", timestamps: true },
  { id: "longcheng_v3", name: "龙诚", gender: "male", style: "智慧青年男声", timestamps: true },
  { id: "longfei_v3", name: "龙飞", gender: "male", style: "热血磁性男声", timestamps: true },
  { id: "longshuo_v3", name: "龙硕", gender: "male", style: "博学干练男声", timestamps: true },
  { id: "longlaotie_v3", name: "龙老铁", gender: "male", style: "东北口音男声，适合搞笑", timestamps: true },
  { id: "longxiaochun_v3", name: "龙小淳", gender: "female", style: "知性积极女声", timestamps: true },
  { id: "longwan_v3", name: "龙婉", gender: "female", style: "知性温柔女声", timestamps: true },
  { id: "longyue_v3", name: "龙悦", gender: "female", style: "温暖磁性女声", timestamps: true },
  { id: "longxiaoxia_v3", name: "龙小夏", gender: "female", style: "沉稳权威女声", timestamps: true },
  { id: "loongbella_v3", name: "Bella", gender: "female", style: "干练播报女声", timestamps: true },
  { id: "longmiao_v3", name: "龙妙", gender: "female", style: "抑扬顿挫女声，适合讲故事", timestamps: true },
  { id: "longhua_v3", name: "龙华", gender: "female", style: "元气甜美女声", timestamps: true },
  { id: "longyumi_v3", name: "龙玉米", gender: "female", style: "青春女声", timestamps: true },
  { id: "longjielidou_v3", name: "龙杰力豆", gender: "child", style: "阳光童声", timestamps: true },
  { id: "longhuhu_v3", name: "龙呼呼", gender: "child", style: "天真女童声", timestamps: true },
];

const qwenAudioVoices: Voice[] = [
  { id: "longanhuan_v3.6", name: "龙安欢 3.6", gender: "female", style: "自然元气女声", timestamps: true, instruct: true, ssml: true, emotionTags: true },
];

export function isQwenAudioModel(model: string) {
  return QWEN_AUDIO_MODELS.has(model);
}

export function qwenAudioHttpUrl(
  explicit = process.env.DASHSCOPE_TTS_HTTP_URL?.trim(),
  workspaceId = process.env.DASHSCOPE_WORKSPACE_ID?.trim(),
) {
  return explicit || (workspaceId ? `https://${workspaceId}.cn-beijing.maas.aliyuncs.com${HTTP_TTS_PATH}` : undefined);
}

const models: TtsModel[] = [
  { id: "cosyvoice-v3-flash", label: "CosyVoice v3 Flash（推荐）", transport: "websocket", capabilities: ["word-timestamps"] },
  { id: "cosyvoice-v3-plus", label: "CosyVoice v3 Plus", transport: "websocket", capabilities: ["word-timestamps"] },
  { id: "qwen-audio-3.0-tts-plus", label: "Qwen-Audio 3.0 TTS Plus", transport: "http-sse", capabilities: ["word-timestamps", "instruct", "ssml", "emotion-tags"] },
  { id: "qwen-audio-3.0-tts-flash", label: "Qwen-Audio 3.0 TTS Flash", transport: "http-sse", capabilities: ["word-timestamps", "instruct", "ssml", "emotion-tags"] },
  { id: "qwen-audio-3.1-tts-flash", label: "Qwen-Audio 3.1 TTS Flash", transport: "http-sse", capabilities: ["word-timestamps", "instruct", "ssml", "emotion-tags"] },
];

export class TtsError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
  ) {
    super(message);
  }
}

function classify(code: string | undefined, message: string) {
  const text = `${code ?? ""} ${message}`;
  // 参数错误、音色与模型不匹配、内容审核、欠费：重试无意义
  if (/InvalidParameter|not supported|418|DataInspection|Arrearage|AccessDenied|InvalidApiKey|Unauthorized|audit|审核/i.test(text)) {
    return new PermanentError(`语音合成失败：${message}${code ? `（${code}）` : ""}`);
  }
  return new TtsError(`语音合成失败：${message}${code ? `（${code}）` : ""}`, code, /Throttl|RateLimit/i.test(text) ? 429 : 500);
}

export function createDashscopeTts(
  apiKey = process.env.DASHSCOPE_API_KEY?.trim(),
  url = process.env.DASHSCOPE_TTS_URL?.trim() || URL_DEFAULT,
  httpUrl = qwenAudioHttpUrl(),
): TtsProvider {
  return {
    id: "dashscope",
    models,
    voices: (model) => (isQwenAudioModel(model) ? qwenAudioVoices : model === "cosyvoice-v3-flash" ? v3Voices : v3Voices.filter((v) => v.id === "longanyang")),
    synthesize(req, signal) {
      if (!apiKey) return Promise.reject(new PermanentError("未配置 DASHSCOPE_API_KEY，无法配音"));
      if (isQwenAudioModel(req.model)) {
        if (!httpUrl) return Promise.reject(new PermanentError("Qwen-Audio 需要配置 DASHSCOPE_TTS_HTTP_URL 或 DASHSCOPE_WORKSPACE_ID"));
        return synthesizeHttp(apiKey, httpUrl, req, signal);
      }
      return synthesizeWebSocket(apiKey, url, req, signal);
    },
  };
}

function synthesizeWebSocket(apiKey: string, url: string, req: SynthRequest, signal?: AbortSignal): Promise<SynthResult> {
  return new Promise((resolve, reject) => {
    const taskId = randomUUID().replace(/-/g, "");
    const ws = new WebSocket(url, { headers: { Authorization: `bearer ${apiKey}`, "X-DashScope-DataInspection": "enable" } });
    const chunks: Buffer[] = [];
    const sentences = new Map<number, SynthWord[]>();
    let settled = false;
    const done = (err: Error | null, value?: SynthResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      try {
        ws.close();
      } catch {}
      if (err) reject(err);
      else resolve(value!);
    };
    const onAbort = () => {
      ws.terminate();
      done(signal?.reason instanceof Error ? signal.reason : new DOMException("已取消", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    // 单句一般 1–3 秒；60 秒没结束视为超时（可重试）
    const timer = setTimeout(() => {
      ws.terminate();
      done(new TtsError("语音合成超时", "Timeout", 504));
    }, 60_000);

    const send = (action: string, payload: unknown) => ws.send(JSON.stringify({ header: { action, task_id: taskId, streaming: "duplex" }, payload }));

    ws.on("open", () =>
      send("run-task", {
        task_group: "audio",
        task: "tts",
        function: "SpeechSynthesizer",
        model: req.model,
        parameters: {
          text_type: "PlainText",
          voice: req.voice,
          format: "pcm",
          sample_rate: SAMPLE_RATE,
          volume: req.volume,
          rate: req.rate,
          pitch: req.pitch,
          word_timestamp_enabled: req.wordTimestampEnabled ?? true,
          ...(req.textType ? { text_type: req.textType } : {}),
        },
        input: {},
      }),
    );

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        chunks.push(data as Buffer);
        return;
      }
      let msg: { header: { event: string; error_code?: string; error_message?: string }; payload?: { output?: { type?: string; sentence?: { index: number; words: { text: string; begin_time: number; end_time: number }[] } }; usage?: { characters?: number } } };
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      const ev = msg.header.event;
      if (ev === "task-started") {
        send("continue-task", { input: { text: req.text } });
        send("finish-task", { input: {} });
      } else if (ev === "result-generated") {
        const s = msg.payload?.output?.sentence;
        // 同一句会多次推送，词表逐步变长；保留最长的一次
        if (s?.words?.length && (sentences.get(s.index)?.length ?? 0) <= s.words.length) {
          sentences.set(
            s.index,
            s.words.map((w) => ({ text: w.text, startMs: w.begin_time, endMs: w.end_time })),
          );
        }
      } else if (ev === "task-finished") {
        const pcm = Buffer.concat(chunks);
        if (pcm.length === 0) return done(new TtsError("语音合成没有返回音频", "EmptyAudio", 500));
        const durationMs = Math.round((pcm.length / 2 / SAMPLE_RATE) * 1000);
        done(null, {
          audio: pcmToWav(pcm, SAMPLE_RATE),
          sampleRate: SAMPLE_RATE,
          durationMs,
          words: mergeSentences(sentences),
          billedChars: msg.payload?.usage?.characters ?? 0,
        });
      } else if (ev === "task-failed") {
        done(classify(msg.header.error_code, msg.header.error_message ?? "未知错误"));
      }
    });

    ws.on("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (d: Buffer) => (body += d));
      res.on("end", () => {
        const e = res.statusCode === 401 || res.statusCode === 403 ? new PermanentError(`语音合成鉴权失败（HTTP ${res.statusCode}），请检查 DASHSCOPE_API_KEY`) : new TtsError(`语音合成连接失败（HTTP ${res.statusCode}）${body.slice(0, 200)}`, "Http", res.statusCode);
        done(e);
      });
    });
    ws.on("error", (e) => done(new TtsError(`语音合成连接出错：${e.message}`, "Network", 503)));
    ws.on("close", () => done(new TtsError("语音合成连接意外关闭", "Closed", 503)));
  });
}

type JsonObject = Record<string, unknown>;

function pcmFromChunk(chunk: Buffer) {
  if (chunk.length >= 44 && chunk.toString("ascii", 0, 4) === "RIFF") {
    const dataOffset = chunk.indexOf(Buffer.from("data"), 12);
    return dataOffset >= 0 ? chunk.subarray(dataOffset + 8) : chunk.subarray(44);
  }
  return chunk;
}

export function parseDashscopeHttpEvents(text: string): unknown[] {
  return text.split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") return [];
    try {
      return [JSON.parse(data) as unknown];
    } catch {
      return [];
    }
  });
}

async function readResponseEvents(response: Response) {
  const raw = await response.text();
  const events = parseDashscopeHttpEvents(raw);
  if (events.length) return events;
  try {
    return raw.trim() ? [JSON.parse(raw) as unknown] : [];
  } catch {
    return [];
  }
}

function collectHttpOutput(value: unknown, audio: Buffer[], urls: string[], words: SynthWord[], billed: { value?: number }) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectHttpOutput(item, audio, urls, words, billed);
    return;
  }
  const object = value as JsonObject;
  if (typeof object.data === "string" && object.data) {
    try {
      audio.push(Buffer.from(object.data, "base64"));
    } catch {
      // malformed chunks are ignored; the empty-audio check reports a useful error below
    }
  }
  if (typeof object.url === "string" && object.url) urls.push(object.url);
  if (Array.isArray(object.words)) {
    for (const item of object.words) {
      if (!item || typeof item !== "object") continue;
      const word = item as JsonObject;
      if (typeof word.text === "string" && typeof word.begin_time === "number" && typeof word.end_time === "number") {
        words.push({ text: word.text, startMs: word.begin_time, endMs: word.end_time });
      }
    }
  }
  for (const key of ["characters", "char_count", "billed_chars"]) {
    if (typeof object[key] === "number") billed.value = object[key] as number;
  }
  for (const child of Object.values(object)) collectHttpOutput(child, audio, urls, words, billed);
}

function uniqueWords(words: SynthWord[]) {
  const seen = new Set<string>();
  return words
    .filter((word) => {
      const key = `${word.text}\u0000${word.startMs}\u0000${word.endMs}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

export type ParsedHttpTtsResponse = {
  audio: Buffer;
  audioUrls: string[];
  words: SynthWord[];
  billedChars: number;
};

export function parseDashscopeHttpResponse(events: unknown[]): ParsedHttpTtsResponse {
  const chunks: Buffer[] = [];
  const audioUrls: string[] = [];
  const words: SynthWord[] = [];
  const billed: { value?: number } = {};
  for (const event of events) collectHttpOutput(event, chunks, audioUrls, words, billed);
  return { audio: Buffer.concat(chunks.map(pcmFromChunk)), audioUrls, words: uniqueWords(words), billedChars: billed.value ?? 0 };
}

export function buildDashscopeHttpRequest(req: SynthRequest, url: string) {
  const input: JsonObject = {
    text: req.text,
    voice: req.voice,
    format: "wav",
    sample_rate: SAMPLE_RATE,
    word_timestamp_enabled: req.wordTimestampEnabled ?? true,
    rate: req.rate,
    volume: req.volume,
    pitch: req.pitch,
  };
  if (req.textType === "SSML") input.text_type = "SSML";
  if (req.instruction && req.textType !== "SSML") input.instruction = req.instruction;
  if (req.instructions) input.instructions = req.instructions;
  return { url, body: { model: req.model, input } };
}

async function synthesizeHttp(apiKey: string, url: string, req: SynthRequest, signal?: AbortSignal): Promise<SynthResult> {
  const timeout = AbortSignal.timeout(120_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const request = buildDashscopeHttpRequest(req, url);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-DashScope-SSE": "enable" },
      body: JSON.stringify(request.body),
      signal: requestSignal,
    });
  } catch (error) {
    if (requestSignal.aborted) throw requestSignal.reason instanceof Error ? requestSignal.reason : new TtsError("语音合成请求已取消", "AbortError", 499);
    throw new TtsError(`语音合成连接出错：${error instanceof Error ? error.message : String(error)}`, "Network", 503);
  }
  const events = await readResponseEvents(response);
  if (!response.ok) {
    const error = events[0] && typeof events[0] === "object" ? events[0] as JsonObject : {};
    const code = typeof error.code === "string" ? error.code : undefined;
    const message = typeof error.message === "string" ? error.message : `HTTP ${response.status}`;
    throw classify(code, message);
  }
  const parsed = parseDashscopeHttpResponse(events);
  let audio = parsed.audio;
  const audioUrl = parsed.audioUrls.at(-1);
  if (!audio.length && audioUrl) {
    const audioResponse = await fetch(audioUrl, { signal: requestSignal });
    if (!audioResponse.ok) throw new TtsError(`音频 URL 下载失败（HTTP ${audioResponse.status}）`, "Http", audioResponse.status);
    audio = Buffer.from(await audioResponse.arrayBuffer());
  }
  if (!audio.length) throw new TtsError("语音合成没有返回音频", "EmptyAudio", 500);
  const wav = audio.toString("ascii", 0, 4) === "RIFF" ? audio : pcmToWav(audio, SAMPLE_RATE);
  const dataOffset = wav.indexOf(Buffer.from("data"), 12);
  const pcmBytes = dataOffset >= 0 ? wav.length - dataOffset - 8 : Math.max(0, wav.length - 44);
  const durationMs = Math.round((pcmBytes / 2 / SAMPLE_RATE) * 1000);
  return { audio: wav, sampleRate: SAMPLE_RATE, durationMs, words: parsed.words, billedChars: parsed.billedChars };
}

/** 多个句子的词表按序拼接；若某句时间从 0 重新计，则平移到上一句之后 */
export function mergeSentences(sentences: Map<number, SynthWord[]>): SynthWord[] {
  const out: SynthWord[] = [];
  for (const idx of [...sentences.keys()].sort((a, b) => a - b)) {
    const words = sentences.get(idx)!;
    const last = out[out.length - 1]?.endMs ?? 0;
    const offset = words.length && words[0].startMs < last - 50 ? last : 0;
    for (const w of words) out.push({ text: w.text, startMs: w.startMs + offset, endMs: w.endMs + offset });
  }
  return out;
}

let singleton: TtsProvider | null = null;
export function dashscopeTts() {
  return (singleton ??= createDashscopeTts());
}
