import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "crypto";
import { all, get, run, tx } from "../server/db";
import type { ProviderInterfaceType } from "./types";

type CustomProviderRow = {
  id: string;
  name: string;
  interface_type: ProviderInterfaceType;
  base_url: string;
  encrypted_api_key: string;
  key_hint: string;
  enabled: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

type CustomModelRow = { provider_id: string; model_id: string; model_label: string; kind: "text" | "image"; enabled: number; updated_at: number };

function secretKey() {
  const raw = process.env.PROVIDER_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("未配置 PROVIDER_ENCRYPTION_KEY，无法安全保存第三方服务商 Key");
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : createHash("sha256").update(raw).digest();
  if (key.length !== 32) throw new Error("PROVIDER_ENCRYPTION_KEY 必须是 32 字节密钥或任意非空密钥短语");
  return key;
}

export function encryptApiKey(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptApiKey(value: string) {
  const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error("第三方服务商 Key 存储格式无效");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64url")), decipher.final()]).toString("utf8");
}

export type CustomProviderInput = { name: string; interfaceType: ProviderInterfaceType; baseUrl: string; apiKey: string };

export function normalizeBaseUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Base URL 不是有效地址"); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Base URL 只支持 HTTP 或 HTTPS");
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function createCustomProvider(input: CustomProviderInput) {
  const name = input.name.trim();
  const apiKey = input.apiKey.trim();
  if (!name) throw new Error("请填写服务商名称");
  if (!apiKey) throw new Error("请填写 API Key");
  const id = randomUUID();
  const now = Date.now();
  run("INSERT INTO custom_providers (id, name, interface_type, base_url, encrypted_api_key, key_hint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, name, input.interfaceType, normalizeBaseUrl(input.baseUrl), encryptApiKey(apiKey), `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}`, now, now);
  return id;
}

export function customProvider(id: string) {
  return get<CustomProviderRow>("SELECT * FROM custom_providers WHERE id = ?", id);
}

export function customProviderApiKey(id: string) {
  const row = customProvider(id);
  return row ? decryptApiKey(row.encrypted_api_key) : undefined;
}

export function customProviderConfigured(id: string) {
  try {
    return !!customProviderApiKey(id);
  } catch {
    return false;
  }
}

export function updateCustomProvider(id: string, input: { baseUrl?: string; apiKey?: string }) {
  const current = customProvider(id);
  if (!current) return undefined;
  const baseUrl = input.baseUrl ? normalizeBaseUrl(input.baseUrl) : current.base_url;
  const apiKey = input.apiKey?.trim();
  run("UPDATE custom_providers SET base_url = ?, encrypted_api_key = ?, key_hint = ?, updated_at = ? WHERE id = ?", baseUrl, apiKey ? encryptApiKey(apiKey) : current.encrypted_api_key, apiKey ? `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}` : current.key_hint, Date.now(), id);
  return customProvider(id);
}

export function customProviders() {
  return all<CustomProviderRow>("SELECT * FROM custom_providers ORDER BY created_at DESC");
}

export function customModels(providerId?: string) {
  return providerId ? all<CustomModelRow>("SELECT * FROM custom_provider_models WHERE provider_id = ? ORDER BY model_id", providerId) : all<CustomModelRow>("SELECT * FROM custom_provider_models ORDER BY provider_id, model_id");
}

export function syncCustomModels(providerId: string, models: { id: string; label?: string }[]) {
  tx(() => {
    const now = Date.now();
    for (const model of models) {
      const id = model.id.trim();
      if (!id) continue;
      run("INSERT INTO custom_provider_models (provider_id, model_id, model_label, enabled, updated_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(provider_id, model_id) DO UPDATE SET model_label = excluded.model_label, updated_at = excluded.updated_at", providerId, id, (model.label || id).trim(), now);
    }
    run("UPDATE custom_providers SET last_error = NULL, updated_at = ? WHERE id = ?", now, providerId);
  });
  return customModels(providerId);
}

export function markCustomProviderError(providerId: string, message: string) {
  run("UPDATE custom_providers SET last_error = ?, updated_at = ? WHERE id = ?", message.slice(0, 500), Date.now(), providerId);
}

export function setCustomModelEnabled(providerId: string, modelId: string, enabled: boolean) {
  run("UPDATE custom_provider_models SET enabled = ?, updated_at = ? WHERE provider_id = ? AND model_id = ?", enabled ? 1 : 0, Date.now(), providerId, modelId);
  return customModels(providerId).find((m) => m.model_id === modelId);
}

export function setCustomModelKind(providerId: string, modelId: string, kind: "text" | "image") {
  run("UPDATE custom_provider_models SET kind = ?, updated_at = ? WHERE provider_id = ? AND model_id = ?", kind, Date.now(), providerId, modelId);
  return customModels(providerId).find((m) => m.model_id === modelId);
}

export function deleteCustomProvider(providerId: string) {
  return run("DELETE FROM custom_providers WHERE id = ?", providerId).changes > 0;
}

export async function fetchRemoteModels(input: { interfaceType: ProviderInterfaceType; baseUrl: string; apiKey: string }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const url = new URL(baseUrl);
    const pathname = url.pathname.replace(/\/+$/, "");
    // 兼容填写根地址和已经带 /v1 的 Base URL；Anthropic 官方目录也是 /v1/models。
    const paths = pathname.endsWith("/v1") ? [`${pathname}/models`] : [`${pathname}/v1/models`, `${pathname}/models`];
    let lastError = "";
    for (const path of [...new Set(paths)]) {
      const endpoint = `${url.origin}${path || "/models"}`;
      const response = await fetch(endpoint, {
        method: "GET",
        signal: controller.signal,
        headers: input.interfaceType === "anthropic"
          ? { "x-api-key": input.apiKey, "anthropic-version": "2023-06-01", Accept: "application/json" }
          : { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" },
      });
      const raw = await response.text();
      let body: unknown = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      if (!response.ok) {
        const detail = typeof body === "object" && body !== null && "error" in body && typeof body.error === "object" && body.error !== null && "message" in body.error ? String(body.error.message) : typeof body === "object" && body !== null && "message" in body ? String(body.message) : `HTTP ${response.status}`;
        lastError = `${endpoint}：${detail}`;
        if (response.status === 404 || response.status === 405) continue;
        throw new Error(`拉取模型失败（${lastError}）`);
      }
      const items = typeof body === "object" && body !== null && "data" in body && Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
      const models = items.map((item) => {
        if (typeof item === "string") return { id: item, label: item };
        if (!item || typeof item !== "object") return null;
        const record = item as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id : typeof record.name === "string" ? record.name : "";
        return id ? { id, label: typeof record.display_name === "string" ? record.display_name : typeof record.name === "string" ? record.name : id } : null;
      }).filter((m): m is { id: string; label: string } => !!m);
      if (!models.length) throw new Error(`${endpoint} 返回中没有可识别的模型`);
      return models;
    }
    throw new Error(`拉取模型失败：未找到模型目录接口（${lastError || "请检查 Base URL"}）。OpenAI Compatible 通常填写到 /v1，Anthropic 通常使用根地址或 /v1。`);
  } finally {
    clearTimeout(timer);
  }
}
