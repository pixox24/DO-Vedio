import type { ProviderCapability, ProviderKind, AdapterStatus } from "./types";

export type BuiltinModel = {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  kind: ProviderKind;
  adapter: string;
  adapterStatus: AdapterStatus;
  capabilities: ProviderCapability[];
  authEnv?: string;
  baseUrl?: string;
  baseUrlEnv?: string;
  modelEnv?: string;
  configEnvs?: string[];
  enabled: boolean;
  defaults?: Record<string, unknown>;
  limits?: Record<string, number | string>;
  price?: Record<string, number | boolean | string>;
};

/** 内置目录只描述能力和默认连接信息，不包含任何密钥。 */
export const builtinModels: BuiltinModel[] = [
  { providerId: "deepseek", providerLabel: "DeepSeek", modelId: "deepseek-chat", modelLabel: "DeepSeek Chat", kind: "text", adapter: "vercel-ai", adapterStatus: "ready", capabilities: ["stream", "structured-output"], authEnv: "DEEPSEEK_API_KEY", baseUrl: "https://api.deepseek.com/v1", baseUrlEnv: "DEEPSEEK_BASE_URL", modelEnv: "DEEPSEEK_MODEL", enabled: true },
  { providerId: "qwen", providerLabel: "通义千问", modelId: "qwen-plus", modelLabel: "通义千问 Plus", kind: "text", adapter: "vercel-ai", adapterStatus: "ready", capabilities: ["stream", "structured-output", "web-search"], authEnv: "DASHSCOPE_API_KEY", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", baseUrlEnv: "QWEN_BASE_URL", modelEnv: "QWEN_MODEL", enabled: true },
  { providerId: "kimi", providerLabel: "Kimi", modelId: "kimi-latest", modelLabel: "Kimi Latest", kind: "text", adapter: "vercel-ai", adapterStatus: "ready", capabilities: ["stream", "structured-output"], authEnv: "MOONSHOT_API_KEY", baseUrl: "https://api.moonshot.cn/v1", baseUrlEnv: "KIMI_BASE_URL", modelEnv: "KIMI_MODEL", enabled: true },
  { providerId: "doubao", providerLabel: "豆包", modelId: "doubao-seed-1-6-250615", modelLabel: "豆包 Seed", kind: "text", adapter: "vercel-ai", adapterStatus: "ready", capabilities: ["stream", "structured-output"], authEnv: "ARK_API_KEY", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", baseUrlEnv: "DOUBAO_BASE_URL", modelEnv: "DOUBAO_MODEL", enabled: true },
  { providerId: "openai", providerLabel: "OpenAI", modelId: "gpt-5", modelLabel: "GPT-5", kind: "text", adapter: "vercel-ai", adapterStatus: "ready", capabilities: ["stream", "structured-output"], authEnv: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1", baseUrlEnv: "OPENAI_BASE_URL", modelEnv: "OPENAI_MODEL", enabled: true },
  { providerId: "anthropic", providerLabel: "Claude", modelId: "claude-opus-5", modelLabel: "Claude Opus", kind: "text", adapter: "vercel-ai", adapterStatus: "ready", capabilities: ["stream", "structured-output"], authEnv: "ANTHROPIC_API_KEY", baseUrlEnv: "ANTHROPIC_BASE_URL", modelEnv: "ANTHROPIC_MODEL", enabled: true },
  { providerId: "dashscope", providerLabel: "阿里云百炼 CosyVoice", modelId: "cosyvoice-v3-flash", modelLabel: "CosyVoice v3 Flash", kind: "tts", adapter: "dashscope-tts", adapterStatus: "ready", capabilities: ["word-timestamps"], authEnv: "DASHSCOPE_API_KEY", baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/inference/", baseUrlEnv: "DASHSCOPE_TTS_URL", enabled: true, price: { perTenThousandChars: 1, verified: false } },
  { providerId: "dashscope", providerLabel: "阿里云百炼 CosyVoice", modelId: "cosyvoice-v3-plus", modelLabel: "CosyVoice v3 Plus", kind: "tts", adapter: "dashscope-tts", adapterStatus: "ready", capabilities: ["word-timestamps"], authEnv: "DASHSCOPE_API_KEY", baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/inference/", baseUrlEnv: "DASHSCOPE_TTS_URL", enabled: true, price: { perTenThousandChars: 2, verified: false } },
  { providerId: "dashscope", providerLabel: "阿里云百炼 Qwen-Audio TTS", modelId: "qwen-audio-3.0-tts-plus", modelLabel: "Qwen-Audio 3.0 TTS Plus", kind: "tts", adapter: "dashscope-tts", adapterStatus: "ready", capabilities: ["word-timestamps", "instruct", "ssml", "emotion-tags"], authEnv: "DASHSCOPE_API_KEY", baseUrlEnv: "DASHSCOPE_TTS_HTTP_URL", enabled: true, price: { perTenThousandChars: 2, verified: false } },
  { providerId: "dashscope", providerLabel: "阿里云百炼 Qwen-Audio TTS", modelId: "qwen-audio-3.0-tts-flash", modelLabel: "Qwen-Audio 3.0 TTS Flash", kind: "tts", adapter: "dashscope-tts", adapterStatus: "ready", capabilities: ["word-timestamps", "instruct", "ssml", "emotion-tags"], authEnv: "DASHSCOPE_API_KEY", baseUrlEnv: "DASHSCOPE_TTS_HTTP_URL", enabled: true, price: { perTenThousandChars: 1, verified: false } },
  { providerId: "dashscope", providerLabel: "阿里云百炼 Qwen-Audio TTS", modelId: "qwen-audio-3.1-tts-flash", modelLabel: "Qwen-Audio 3.1 TTS Flash", kind: "tts", adapter: "dashscope-tts", adapterStatus: "ready", capabilities: ["word-timestamps", "instruct", "ssml", "emotion-tags"], authEnv: "DASHSCOPE_API_KEY", baseUrlEnv: "DASHSCOPE_TTS_HTTP_URL", enabled: true, price: { perTenThousandChars: 1, verified: false } },
  { providerId: "replicate", providerLabel: "Replicate", modelId: "image-generation", modelLabel: "图片生成（配置模型版本后可用）", kind: "image", adapter: "replicate", adapterStatus: "ready", capabilities: ["reference-image", "character-consistency", "scene-consistency", "seed"], authEnv: "REPLICATE_API_TOKEN", configEnvs: ["REPLICATE_IMAGE_MODEL"], baseUrl: "https://api.replicate.com/v1", baseUrlEnv: "REPLICATE_BASE_URL", enabled: false },
  { providerId: "replicate", providerLabel: "Replicate", modelId: "video-generation", modelLabel: "视频生成（配置模型版本后可用）", kind: "video", adapter: "replicate", adapterStatus: "ready", capabilities: ["reference-image", "character-consistency", "scene-consistency", "seed", "first-last-frame"], authEnv: "REPLICATE_API_TOKEN", configEnvs: ["REPLICATE_VIDEO_MODEL"], baseUrl: "https://api.replicate.com/v1", baseUrlEnv: "REPLICATE_BASE_URL", enabled: false },
];

export function modelEnvName(model: BuiltinModel) {
  return model.modelEnv ? process.env[model.modelEnv]?.trim() || model.modelId : model.modelId;
}

export function baseUrlOf(model: BuiltinModel) {
  return (model.baseUrlEnv && process.env[model.baseUrlEnv]?.trim()) || model.baseUrl;
}

export function getBuiltinTextModel(providerId: string) {
  return builtinModels.find((m) => m.kind === "text" && m.providerId === providerId);
}
