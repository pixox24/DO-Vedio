/** 语音合成服务商接口 */

export type Voice = {
  id: string;
  name: string;
  gender: "male" | "female" | "child";
  style: string;
  /** 支持字级时间戳 */
  timestamps: boolean;
  /** 支持自然语言表达控制、SSML 或文本内情绪标签（以模型/音色实际能力为准） */
  instruct?: boolean;
  ssml?: boolean;
  emotionTags?: boolean;
  capabilities?: TtsCapability[];
};

export type TtsCapability =
  | "style-prompt"
  | "multi-speaker"
  | "ssml"
  | "word-timestamps"
  | "sentence-timestamps"
  | "raw-pcm"
  | "wav"
  | "numeric-rate"
  | "numeric-pitch"
  | "numeric-volume"
  | "instruct"
  | "emotion-tags";

export type TtsModel = {
  id: string;
  label: string;
  transport?: "websocket" | "http-sse" | "http-json";
  capabilities?: TtsCapability[];
  configured?: boolean;
  configurationHint?: string;
  limits?: Record<string, number | string>;
  price?: Record<string, number | boolean | string>;
};

export type SynthRequest = {
  text: string;
  model: string;
  voice: string;
  /** DashScope 的兼容参数；不支持的服务商保持未定义。 */
  rate?: number;
  pitch?: number;
  volume?: number;
  /** Qwen-Audio 等 HTTP 模型的自然语言表达控制。 */
  instruction?: string;
  /** 与正文分开的自然语言表达指令。 */
  stylePrompt?: string;
  /** Qwen3-TTS 使用的参数名；当前生产目录未默认启用该模型。 */
  instructions?: string;
  /** SSML 请求时把 text 当作 SSML 发送。 */
  textType?: "PlainText" | "SSML";
  /** 未显式关闭时保持现有字级时间戳行为。 */
  wordTimestampEnabled?: boolean;
  output?: {
    encoding: "LINEAR16" | "WAV";
    sampleRateHertz?: number;
  };
  alignment?: "provider" | "estimated";
  providerOptions?: Record<string, unknown>;
};

export type SynthWord = { text: string; startMs: number; endMs: number };

export type TtsUsage = {
  unit: "characters" | "input-tokens" | "output-tokens" | "seconds" | "unknown";
  quantity: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
  costSource: "provider" | "pricing-table" | "unknown";
};

export type TtsErrorCode =
  | "auth"
  | "invalid-request"
  | "model-unavailable"
  | "quota"
  | "rate-limit"
  | "timeout"
  | "upstream"
  | "invalid-audio"
  | "safety"
  | "aborted";

export type SynthResult = {
  /** WAV（PCM 16bit 单声道） */
  audio: Buffer;
  mime: "audio/wav";
  sampleRate: number;
  channels: number;
  bitsPerSample?: number;
  durationMs: number;
  words: SynthWord[];
  /** 服务商计费字符数 */
  billedChars: number;
  usage?: TtsUsage;
  alignmentSource?: "provider" | "forced" | "estimated";
  retryCount?: number;
};

export interface TtsProvider {
  id: string;
  models: TtsModel[];
  voices(model: string): Voice[];
  synthesize(req: SynthRequest, signal?: AbortSignal): Promise<SynthResult>;
}

/** PCM → WAV */
export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bits = 16) {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bits) / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
