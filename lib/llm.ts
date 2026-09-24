import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output, streamText, type LanguageModel } from "ai";
import { z } from "zod";
import { STREAM_ERROR_MARK, type ModelInfo } from "./types";

type ProviderDef = {
  id: string;
  label: string;
  keyEnv: string;
  baseURL: string;
  defaultModel: string;
};

/** OpenAI 兼容协议的服务商；模型名和地址均可用 <ID>_MODEL / <ID>_BASE_URL 覆盖 */
const compatible: ProviderDef[] = [
  { id: "deepseek", label: "DeepSeek", keyEnv: "DEEPSEEK_API_KEY", baseURL: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  { id: "qwen", label: "通义千问", keyEnv: "DASHSCOPE_API_KEY", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus" },
  { id: "kimi", label: "Kimi", keyEnv: "MOONSHOT_API_KEY", baseURL: "https://api.moonshot.cn/v1", defaultModel: "kimi-latest" },
  { id: "doubao", label: "豆包", keyEnv: "ARK_API_KEY", baseURL: "https://ark.cn-beijing.volces.com/api/v3", defaultModel: "doubao-seed-1-6-250615" },
  { id: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY", baseURL: "https://api.openai.com/v1", defaultModel: "gpt-5" },
];

const env = (name: string) => process.env[name]?.trim() || undefined;

function modelName(id: string, fallback: string) {
  return env(`${id.toUpperCase()}_MODEL`) ?? fallback;
}

export function listModels(): ModelInfo[] {
  const list = compatible
    .filter((p) => env(p.keyEnv))
    .map((p) => ({ id: p.id, label: p.label, model: modelName(p.id, p.defaultModel) }));
  if (env("ANTHROPIC_API_KEY")) {
    list.push({ id: "claude", label: "Claude", model: modelName("anthropic", "claude-opus-5") });
  }
  return list;
}

function getModel(id: string): { model: LanguageModel; isClaude: boolean } {
  if (id === "claude") {
    const apiKey = env("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("未配置 ANTHROPIC_API_KEY");
    const anthropic = createAnthropic({ apiKey, baseURL: env("ANTHROPIC_BASE_URL") });
    return { model: anthropic(modelName("anthropic", "claude-opus-5")), isClaude: true };
  }
  const p = compatible.find((x) => x.id === id);
  const apiKey = p && env(p.keyEnv);
  if (!p || !apiKey) throw new Error(`模型 ${id} 未配置`);
  const provider = createOpenAICompatible({
    name: p.id,
    apiKey,
    baseURL: env(`${p.id.toUpperCase()}_BASE_URL`) ?? p.baseURL,
  });
  return { model: provider(modelName(p.id, p.defaultModel)), isClaude: false };
}

// Claude 被安全分类器拦截时，由服务端自动改用推荐的后备模型重试
const claudeOptions = { anthropic: { fallbacks: "default" } };

export type Prompt = { instructions: string; prompt: string };

/** 流式纯文本；错误以 STREAM_ERROR_MARK 开头写入流末尾，前端据此提示 */
export function streamPlain(modelId: string, { instructions, prompt }: Prompt, signal?: AbortSignal) {
  const { model, isClaude } = getModel(modelId);
  const result = streamText({
    model,
    instructions,
    prompt,
    abortSignal: signal,
    providerOptions: isClaude ? claudeOptions : undefined,
  });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const part of result.stream) {
          if (part.type === "text-delta") controller.enqueue(encoder.encode(part.text));
          else if (part.type === "error") throw part.error;
        }
      } catch (e) {
        if (!signal?.aborted) controller.enqueue(encoder.encode(STREAM_ERROR_MARK + errorMessage(e)));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * 结构化输出。兼容协议走 json_object 模式时服务商拿不到 schema，
 * 所以把 schema 写进 instructions，各家模型都能按格式返回。
 */
export async function generateJson<T extends z.ZodType>(modelId: string, schema: T, { instructions, prompt }: Prompt) {
  const { model, isClaude } = getModel(modelId);
  const { output } = await generateText({
    model,
    instructions: `${instructions}\n\n只输出一个 JSON 对象，不要任何解释，结构必须符合以下 JSON Schema：\n${JSON.stringify(z.toJSONSchema(schema))}`,
    prompt,
    output: Output.object({ schema }),
    providerOptions: isClaude ? claudeOptions : undefined,
  });
  return output as z.infer<T>;
}

export function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "未知错误";
}
