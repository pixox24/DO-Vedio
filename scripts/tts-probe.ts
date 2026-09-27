import { loadEnvConfig } from "@next/env";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import { pathToFileURL } from "url";
import { createDashscopeTts } from "../lib/providers/tts/dashscope";
import type { SynthWord } from "../lib/providers/tts/types";

const SAMPLE_TEXT = "这是一次语音合成能力探测。我们会检查音频是否完整、时间戳是否返回，以及情绪指令能否影响表达。";
const HTTP_TTS_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer";
const QWEN_TTS_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const SAMPLE_RATE = 24_000;

type ProbeModel = {
  id: string;
  family: "cosyvoice" | "qwen-audio" | "qwen-tts";
  voiceEnv: string;
  defaultVoice: string;
};

const MODELS: ProbeModel[] = [
  { id: "cosyvoice-v3-flash", family: "cosyvoice", voiceEnv: "TTS_PROBE_COSYVOICE_VOICE", defaultVoice: "longanyang" },
  { id: "qwen-audio-3.0-tts-plus", family: "qwen-audio", voiceEnv: "TTS_PROBE_QWEN_AUDIO_VOICE", defaultVoice: "longanhuan_v3.6" },
  { id: "qwen-audio-3.0-tts-flash", family: "qwen-audio", voiceEnv: "TTS_PROBE_QWEN_AUDIO_VOICE", defaultVoice: "longanhuan_v3.6" },
  { id: "qwen-audio-3.1-tts-flash", family: "qwen-audio", voiceEnv: "TTS_PROBE_QWEN_AUDIO_VOICE", defaultVoice: "longanhuan_v3.6" },
  { id: "qwen3-tts-instruct-flash", family: "qwen-tts", voiceEnv: "TTS_PROBE_QWEN_TTS_VOICE", defaultVoice: "Cherry" },
];

type ProbeVariant = "base" | "instruct" | "emotion" | "ssml";

export type ProbeResult = {
  model: string;
  family: ProbeModel["family"];
  variant: ProbeVariant;
  voice: string;
  transport: "websocket" | "http-sse";
  endpoint?: string;
  status: "succeeded" | "skipped" | "failed";
  elapsedMs: number;
  requestChars: number;
  responseChunks?: number;
  audioBytes?: number;
  durationMs?: number;
  timestampWords?: number;
  timestampCoverage?: number;
  billedChars?: number;
  audioPath?: string;
  audioSha256?: string;
  error?: string;
};

type HttpProbe = {
  audio: Buffer;
  words: SynthWord[];
  billedChars?: number;
  responseChunks: number;
  audioUrl?: string;
};

type CliOptions = {
  models: string[];
  text: string;
  outputDir?: string;
  variants: boolean;
};

function env(name: string) {
  return process.env[name]?.trim() || undefined;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { models: MODELS.map((m) => m.id), text: SAMPLE_TEXT, variants: false };
  for (const arg of argv) {
    if (arg === "--variants") options.variants = true;
    else if (arg.startsWith("--models=")) options.models = arg.slice("--models=".length).split(",").map((x) => x.trim()).filter(Boolean);
    else if (arg.startsWith("--text=")) options.text = arg.slice("--text=".length).trim() || SAMPLE_TEXT;
    else if (arg.startsWith("--output=")) options.outputDir = arg.slice("--output=".length).trim() || undefined;
    else if (arg === "--help" || arg === "-h") {
      console.log("用法：npm run tts:probe -- [--models=a,b] [--text=文案] [--variants] [--output=目录]");
      console.log("默认只做每个模型的基线探测；--variants 会额外探测 Instruct、情绪标签和 SSML（适用时）。");
      process.exit(0);
    }
  }
  return options;
}

function slug(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "probe";
}

function visibleChars(text: string) {
  return text.replace(/<[^>]+>|\[[^\]]+\]/g, "").replace(/\s/g, "").length;
}

function durationFromAudio(audio: Buffer) {
  if (audio.length >= 44 && audio.toString("ascii", 0, 4) === "RIFF") {
    const channels = audio.readUInt16LE(22);
    const sampleRate = audio.readUInt32LE(24);
    const dataOffset = audio.indexOf(Buffer.from("data"), 12);
    if (dataOffset >= 0 && channels > 0 && sampleRate > 0) {
      return Math.round((audio.length - dataOffset - 8) / (channels * 2 * sampleRate) * 1000);
    }
  }
  return Math.round(audio.length / 2 / SAMPLE_RATE * 1000);
}

function pcmFromChunk(chunk: Buffer) {
  if (chunk.length >= 44 && chunk.toString("ascii", 0, 4) === "RIFF") {
    const dataOffset = chunk.indexOf(Buffer.from("data"), 12);
    return dataOffset >= 0 ? chunk.subarray(dataOffset + 8) : chunk.subarray(44);
  }
  return chunk;
}

function toWav(pcm: Buffer) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function collectWords(value: unknown, out: SynthWord[] = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) collectWords(item, out);
    return out;
  }
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.words)) {
    for (const word of object.words) {
      if (!word || typeof word !== "object") continue;
      const item = word as Record<string, unknown>;
      if (typeof item.text === "string" && typeof item.begin_time === "number" && typeof item.end_time === "number") {
        out.push({ text: item.text, startMs: item.begin_time, endMs: item.end_time });
      }
    }
  }
  for (const child of Object.values(object)) collectWords(child, out);
  return out;
}

function collectAudioData(value: unknown, chunks: Buffer[] = [], urls: string[] = []) {
  if (!value || typeof value !== "object") return { chunks, urls };
  if (Array.isArray(value)) {
    for (const item of value) collectAudioData(item, chunks, urls);
    return { chunks, urls };
  }
  const object = value as Record<string, unknown>;
  if (typeof object.data === "string" && object.data) {
    try { chunks.push(Buffer.from(object.data, "base64")); } catch { /* malformed data is reported as empty audio */ }
  }
  if (typeof object.url === "string" && object.url) urls.push(object.url);
  for (const child of Object.values(object)) collectAudioData(child, chunks, urls);
  return { chunks, urls };
}

function collectBilledChars(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = collectBilledChars(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  for (const key of ["characters", "char_count", "billed_chars"]) {
    if (typeof object[key] === "number") return object[key];
  }
  for (const child of Object.values(object)) {
    const found = collectBilledChars(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

function parseSseEvents(text: string) {
  return text.split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return [];
    try { return [JSON.parse(data) as unknown]; } catch { return []; }
  });
}

async function readSse(response: Response) {
  if (!response.body) return { events: [] as unknown[], raw: "" };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    raw += decoder.decode(chunk.value, { stream: true });
  }
  raw += decoder.decode();
  return { events: parseSseEvents(raw), raw };
}

function inputFor(model: ProbeModel, text: string, variant: ProbeVariant, voice: string) {
  const input: Record<string, unknown> = { text, voice };
  if (model.family === "qwen-audio") {
    input.format = "wav";
    input.sample_rate = SAMPLE_RATE;
    input.word_timestamp_enabled = true;
    if (variant === "instruct") input.instruction = "请用沉稳、清晰、略带悬念的纪录片旁白表达。";
    if (variant === "ssml") input.text_type = "SSML";
  } else if (model.family === "qwen-tts") {
    input.language_type = "Chinese";
    if (variant === "instruct") {
      input.instructions = "请用沉稳、清晰、略带悬念的纪录片旁白表达。";
      input.optimize_instructions = true;
    }
  } else {
    input.format = "wav";
    input.sample_rate = SAMPLE_RATE;
    input.word_timestamp_enabled = true;
    if (variant === "instruct") input.instruction = "你说话的情感是neutral。";
    if (variant === "ssml") input.text_type = "SSML";
  }
  return input;
}

function variantText(model: ProbeModel, text: string, variant: ProbeVariant) {
  if (variant !== "emotion") return variant === "ssml" ? `<speak>${text.slice(0, Math.max(1, Math.floor(text.length / 2)))}<break time="400ms"/>${text.slice(Math.max(1, Math.floor(text.length / 2)))}</speak>` : text;
  return model.family === "qwen-audio" ? `[serious]${text.slice(0, Math.max(1, Math.floor(text.length / 2)))}[excited]${text.slice(Math.max(1, Math.floor(text.length / 2)))}` : text;
}

async function probeHttp(model: ProbeModel, voice: string, text: string, variant: ProbeVariant, url: string): Promise<HttpProbe> {
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("DASHSCOPE_API_KEY")}`, "Content-Type": "application/json", "X-DashScope-SSE": "enable" },
    body: JSON.stringify({ model: model.id, input: inputFor(model, variantText(model, text, variant), variant, voice) }),
    signal: AbortSignal.timeout(120_000),
  });
  const { events, raw } = await readSse(response);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 500)}`);
  if (events.length === 0) {
    try {
      const json = JSON.parse(raw) as unknown;
      if (json && typeof json === "object" && "code" in json) throw new Error(`${String((json as Record<string, unknown>).code)}: ${String((json as Record<string, unknown>).message ?? "请求失败")}`);
      events.push(json);
    } catch (error) {
      if (error instanceof Error && /请求失败|Invalid|Error|code/i.test(error.message)) throw error;
    }
  }
  const chunks: Buffer[] = [];
  const urls: string[] = [];
  const words: SynthWord[] = [];
  for (const event of events) {
    collectAudioData(event, chunks, urls);
    collectWords(event, words);
  }
  const audioUrl = urls.at(-1);
  let audio = Buffer.alloc(0);
  if (audioUrl) {
    const audioResponse = await fetch(audioUrl, { signal: AbortSignal.timeout(120_000) });
    if (!audioResponse.ok) throw new Error(`音频 URL 下载失败：HTTP ${audioResponse.status}`);
    audio = Buffer.from(await audioResponse.arrayBuffer());
  } else if (chunks.length) {
    audio = toWav(Buffer.concat(chunks.map(pcmFromChunk)));
  }
  return { audio, words, billedChars: collectBilledChars(events), responseChunks: events.length, audioUrl };
}

function reportResult(result: ProbeResult) {
  const status = result.status === "succeeded" ? "通过" : result.status === "skipped" ? "跳过" : "失败";
  const details = result.status === "succeeded"
    ? `${result.durationMs ?? 0}ms，${result.audioBytes ?? 0} bytes，时间戳 ${result.timestampWords ?? 0} 字`
    : result.error ?? "未知原因";
  console.log(`[${status}] ${result.model} / ${result.variant} / ${result.voice}：${details}`);
}

async function runOne(model: ProbeModel, text: string, variant: ProbeVariant, outputDir: string): Promise<ProbeResult> {
  const voice = env(model.voiceEnv) || model.defaultVoice;
  const startedAt = Date.now();
  const result: ProbeResult = { model: model.id, family: model.family, variant, voice, transport: model.family === "cosyvoice" && !env("DASHSCOPE_TTS_HTTP_URL") ? "websocket" : "http-sse", status: "failed", elapsedMs: 0, requestChars: visibleChars(variantText(model, text, variant)) };
  try {
    if (!env("DASHSCOPE_API_KEY")) {
      result.status = "skipped";
      result.error = "未配置 DASHSCOPE_API_KEY";
      return result;
    }
    let audio: Buffer;
    let words: SynthWord[];
    let billedChars: number | undefined;
    if (result.transport === "websocket") {
      if (variant !== "base") {
        result.status = "skipped";
        result.error = "当前 CosyVoice WebSocket 适配器只做基线；设置 DASHSCOPE_TTS_HTTP_URL 后可探测控制参数";
        return result;
      }
      const res = await createDashscopeTts().synthesize({ text, model: model.id, voice, rate: 1, pitch: 1, volume: 1 });
      audio = res.audio;
      words = res.words;
      billedChars = res.billedChars;
    } else {
      const endpoint = model.family === "qwen-tts" ? env("DASHSCOPE_QWEN_TTS_HTTP_URL") || QWEN_TTS_URL : env("DASHSCOPE_TTS_HTTP_URL") || (env("DASHSCOPE_WORKSPACE_ID") ? `https://${env("DASHSCOPE_WORKSPACE_ID")}.cn-beijing.maas.aliyuncs.com${HTTP_TTS_PATH}` : undefined);
      if (!endpoint) {
        result.status = "skipped";
        result.error = "缺少 DASHSCOPE_WORKSPACE_ID 或 DASHSCOPE_TTS_HTTP_URL";
        return result;
      }
      result.endpoint = endpoint;
      const res = await probeHttp(model, voice, text, variant, endpoint);
      audio = res.audio;
      words = res.words;
      billedChars = res.billedChars;
      result.responseChunks = res.responseChunks;
    }
    if (!audio.length) throw new Error("接口返回成功，但没有音频数据或可下载 URL");
    const file = `${slug(model.id)}-${variant}.wav`;
    await fs.writeFile(`${outputDir}/${file}`, audio);
    result.status = "succeeded";
    result.audioPath = file;
    result.audioBytes = audio.length;
    result.durationMs = durationFromAudio(audio);
    result.timestampWords = words.length;
    result.timestampCoverage = result.requestChars ? Number((words.length / result.requestChars).toFixed(3)) : 0;
    result.billedChars = billedChars;
    result.audioSha256 = createHash("sha256").update(audio).digest("hex");
  } catch (error) {
    result.status = "failed";
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    result.elapsedMs = Date.now() - startedAt;
  }
  return result;
}

function markdown(results: ProbeResult[], outputDir: string) {
  const lines = [
    "# TTS 能力探测报告",
    "",
    `生成时间：${new Date().toISOString()}`,
    `音频目录：${outputDir}`,
    "",
    "| 模型 | 变体 | 音色 | 状态 | 延迟 | 音频时长 | 字级时间戳 | 覆盖率 | 计费字符 | 备注 |",
    "|---|---|---|---|---:|---:|---:|---:|---:|---|",
    ...results.map((r) => `| ${r.model} | ${r.variant} | ${r.voice} | ${r.status} | ${r.elapsedMs} ms | ${r.durationMs ?? "-"} ms | ${r.timestampWords ?? "-"} | ${r.timestampCoverage ?? "-"} | ${r.billedChars ?? "-"} | ${(r.error ?? r.audioPath ?? "").replaceAll("|", "\\|")} |`),
    "",
    "## 人工试听记录",
    "",
    "请对每个成功音频补记：音色一致性、指令是否生效、情绪切换是否自然、停顿是否准确、文本是否有漏读或增读。脚本只自动记录请求和音频事实，不把文件哈希或时长变化误判为情绪效果。",
  ];
  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  const options = parseArgs(argv);
  const selected = MODELS.filter((model) => options.models.includes(model.id));
  const unknown = options.models.filter((id) => !MODELS.some((model) => model.id === id));
  if (unknown.length) throw new Error(`不支持的模型：${unknown.join(", ")}`);
  const outputDir = options.outputDir || `data/tts-probes/${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
  await fs.mkdir(outputDir, { recursive: true });
  const variants: ProbeVariant[] = options.variants ? ["base", "instruct", "emotion", "ssml"] : ["base"];
  const results: ProbeResult[] = [];
  for (const model of selected) {
    for (const variant of variants) {
      if (variant === "emotion" && model.family !== "qwen-audio") {
        const skipped: ProbeResult = { model: model.id, family: model.family, variant, voice: env(model.voiceEnv) || model.defaultVoice, transport: "http-sse", status: "skipped", elapsedMs: 0, requestChars: visibleChars(options.text), error: "文本内情绪标签仅对 Qwen-Audio-TTS 探测" };
        results.push(skipped);
        reportResult(skipped);
        continue;
      }
      if (variant === "ssml" && model.family === "qwen-tts") {
        const skipped: ProbeResult = { model: model.id, family: model.family, variant, voice: env(model.voiceEnv) || model.defaultVoice, transport: "http-sse", status: "skipped", elapsedMs: 0, requestChars: visibleChars(options.text), error: "当前资料未将 SSML 列入 Qwen-TTS 探测范围" };
        results.push(skipped);
        reportResult(skipped);
        continue;
      }
      const result = await runOne(model, options.text, variant, outputDir);
      results.push(result);
      reportResult(result);
    }
  }
  await fs.writeFile(`${outputDir}/report.json`, JSON.stringify({ text: options.text, results }, null, 2));
  await fs.writeFile(`${outputDir}/report.md`, markdown(results, outputDir));
  console.log(`\n报告：${outputDir}/report.md`);
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
