import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output, streamText, type LanguageModel } from "ai";
import { z } from "zod";
import { STREAM_ERROR_MARK, type ModelInfo } from "./types";
import { baseUrlOf, getBuiltinTextModel, modelEnvName } from "./providers/catalog";
import { customTextModel, listProviderProfiles, listTextModels } from "./providers/registry";

const env = (name: string) => process.env[name]?.trim() || undefined;

export function listModels(): ModelInfo[] {
  return listTextModels();
}

/** 第一个已配置、带联网搜索能力的文本模型；没有则返回 undefined */
export function searchModel() {
  const p = listProviderProfiles().find((x) => x.kind === "text" && !x.custom && x.configured && x.enabled && x.capabilities.includes("web-search"));
  return p && { id: p.providerId === "anthropic" ? "claude" : p.providerId, label: `${p.providerLabel} · ${p.modelId}` };
}

/**
 * 联网搜索参数。openai-compatible 会把 providerOptions[providerId] 原样并进请求体，
 * 通义千问据此开启 enable_search（强制搜索、多引擎）。不支持的模型返回 undefined。
 */
export function searchOptions(id: string, strategy: "max" | "turbo" = "max") {
  const p = getBuiltinTextModel(id);
  if (!p?.capabilities.includes("web-search")) return undefined;
  return { [p.providerId]: { enable_search: true, search_options: { forced_search: true, search_strategy: strategy } } };
}

function getModel(id: string): { model: LanguageModel; isClaude: boolean } {
  const custom = customTextModel(id);
  if (custom) {
    if (custom.interfaceType === "anthropic") {
      const anthropic = createAnthropic({ apiKey: custom.apiKey, baseURL: custom.baseUrl });
      return { model: anthropic(custom.modelId), isClaude: true };
    }
    const provider = createOpenAICompatible({ name: custom.providerId, apiKey: custom.apiKey, baseURL: custom.baseUrl });
    return { model: provider(custom.modelId), isClaude: false };
  }
  const providerId = id === "claude" ? "anthropic" : id;
  if (providerId === "anthropic") {
    const apiKey = env("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("未配置 ANTHROPIC_API_KEY");
    const anthropic = createAnthropic({ apiKey, baseURL: env("ANTHROPIC_BASE_URL") });
    return { model: anthropic(modelEnvName(getBuiltinTextModel("anthropic")!)), isClaude: true };
  }
  const p = getBuiltinTextModel(providerId);
  const apiKey = p && env(p.authEnv!);
  if (!p || !apiKey) throw new Error(`模型 ${id} 未配置`);
  const provider = createOpenAICompatible({
    name: p.providerId,
    apiKey,
    baseURL: baseUrlOf(p)!,
  });
  return { model: provider(modelEnvName(p)), isClaude: false };
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
/** 一次性纯文本；search=true 时要求联网（模型不支持则报错） */
/** search：要求联网；quick：用单引擎快速搜索（逐个核实时用），默认多引擎 */
export async function generatePlain(modelId: string, { instructions, prompt }: Prompt, opts: { search?: boolean; quick?: boolean } = {}) {
  const { model, isClaude } = getModel(modelId);
  const search = opts.search ? searchOptions(modelId, opts.quick ? "turbo" : "max") : undefined;
  if (opts.search && !search) throw new Error(`模型 ${modelId} 不支持联网搜索`);
  const { text } = await generateText({ model, instructions, prompt, providerOptions: search ?? (isClaude ? claudeOptions : undefined) });
  return text.trim();
}

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
