import { customImageModel } from "../registry";
import { LONG_REQUEST_MS, longRequest, networkError } from "../http";

type ImageResponse = { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
export type ReferenceImage = { bytes: Uint8Array; mime: string };
export type CustomImageResult = { bytes: Buffer; source: string; /** 带参考图但接口不支持 /images/edits，退回了文生图：说明原因 */ referenceFallback?: string };

/** 这些状态码说明服务商不支持 /images/edits（或这个模型不支持），可以退回文生图 */
const EDITS_UNSUPPORTED = new Set([400, 404, 405, 415, 422, 501]);

/**
 * OpenAI 兼容生图。有参考图时走 /images/edits（多张 image[]，gpt-image 等模型据此保持角色一致），
 * 不支持时退回 /images/generations 并在结果里标明，由调用方写进生成记录。
 */
export async function generateCustomImage(modelId: string, prompt: string, signal?: AbortSignal, references: ReferenceImage[] = []): Promise<CustomImageResult> {
  const model = customImageModel(modelId);
  if (!model) throw new Error("图片模型不可用，请在模型中心检查分类和启用状态");
  const requestSignal = AbortSignal.any([AbortSignal.timeout(LONG_REQUEST_MS), ...(signal ? [signal] : [])]);
  const base = model.baseUrl.replace(/\/$/, "");
  const auth = { Authorization: `Bearer ${model.apiKey}` };

  let referenceFallback: string | undefined;
  if (references.length) {
    const form = new FormData();
    form.append("model", model.modelId);
    form.append("prompt", prompt);
    form.append("n", "1");
    references.forEach((r, i) => form.append("image[]", new Blob([r.bytes as BlobPart], { type: r.mime }), `reference-${i + 1}.${r.mime.split("/")[1] || "png"}`));
    const response = await fetch(`${base}/images/edits`, { method: "POST", headers: auth, body: form, signal: requestSignal, ...longRequest }).catch((e) => {
      throw networkError(e, "生图");
    });
    const body = (await response.json().catch(() => ({}))) as ImageResponse;
    if (response.ok) return { ...(await readImage(body, requestSignal)), source: model.providerId };
    if (!EDITS_UNSUPPORTED.has(response.status)) throw Object.assign(new Error(body.error?.message || `生图失败（HTTP ${response.status}）`), { status: response.status });
    referenceFallback = `接口不支持参考图（HTTP ${response.status}${body.error?.message ? `：${body.error.message}` : ""}），已改用文生图`;
  }

  const response = await fetch(`${base}/images/generations`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ model: model.modelId, prompt, n: 1 }),
    signal: requestSignal,
    ...longRequest,
  }).catch((e) => {
    throw networkError(e, "生图");
  });
  const body = (await response.json().catch(() => ({}))) as ImageResponse;
  if (!response.ok) throw Object.assign(new Error(body.error?.message || `生图失败（HTTP ${response.status}）`), { status: response.status });
  return { ...(await readImage(body, requestSignal)), source: model.providerId, referenceFallback };
}

async function readImage(body: ImageResponse, signal: AbortSignal) {
  const output = body.data?.[0];
  if (output?.b64_json) return { bytes: Buffer.from(output.b64_json, "base64") };
  if (output?.url) {
    const file = await fetch(output.url, { signal, ...longRequest }).catch((e) => {
      throw networkError(e, "下载生成图片");
    });
    if (!file.ok) throw new Error(`下载生成图片失败（HTTP ${file.status}）`);
    return { bytes: Buffer.from(await file.arrayBuffer()) };
  }
  throw new Error("生图接口没有返回图片");
}
