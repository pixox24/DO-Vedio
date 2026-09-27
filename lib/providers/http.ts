import { Agent } from "undici";

/**
 * 生图 / 生视频这类长耗时请求的连接配置。
 * Node 内置 fetch 默认只等 5 分钟响应头：GPT Image 这类模型一张图常要 3–5 分钟，
 * 超时后连接被本地断开（报 “fetch failed”），而服务商那边其实已经画完并计费。
 */
export const LONG_REQUEST_MS = 15 * 60_000;
const longAgent = new Agent({ headersTimeout: LONG_REQUEST_MS, bodyTimeout: LONG_REQUEST_MS, connectTimeout: 30_000 });

/** 传给 fetch 的附加参数：fetch(url, { ...init, ...longRequest }) */
export const longRequest = { dispatcher: longAgent } as unknown as RequestInit;

const causeText: Record<string, string> = {
  UND_ERR_HEADERS_TIMEOUT: "等待服务商返回结果超时",
  UND_ERR_BODY_TIMEOUT: "下载结果超时",
  UND_ERR_CONNECT_TIMEOUT: "连接服务商超时",
  UND_ERR_SOCKET: "连接被服务商中断",
  ECONNRESET: "连接被重置",
  ECONNREFUSED: "服务商拒绝连接",
  ENOTFOUND: "找不到服务商地址",
  ETIMEDOUT: "网络超时",
  EAI_AGAIN: "域名解析失败",
};

/** 把 “fetch failed” 这类底层网络错误翻译成看得懂的原因 */
export function networkError(e: unknown, what = "请求"): Error {
  if (!(e instanceof Error) || e.name === "AbortError" || e.message !== "fetch failed") return e instanceof Error ? e : new Error(String(e));
  const code = (e.cause as { code?: string } | undefined)?.code;
  return Object.assign(new Error(`${what}失败：${(code && causeText[code]) || "网络错误"}${code ? `（${code}）` : ""}`), { cause: e.cause, retryable: true });
}
