import pricing from "../../config/pricing.json";
import { all, get, json, run } from "../server/db";
import { geminiApiKey } from "./tts/gemini";
import { baseUrlOf, builtinModels, modelEnvName, type BuiltinModel } from "./catalog";
import type { ModelProfileOverride, ProviderProfile } from "./types";
import { customModels, customProvider, customProviders, customProviderApiKey, customProviderConfigured, setCustomModelEnabled, setCustomModelKind } from "./custom";

type OverrideRow = { provider_id: string; model_id: string; enabled: number; price: string; defaults: string; limits: string };
const env = (name?: string) => (name ? process.env[name]?.trim() || undefined : undefined);
const enabledEnv = (name?: string) => !name || /^(1|true|yes|on)$/i.test(process.env[name]?.trim() || "");
const parse = <T>(raw: string | null | undefined, fallback: T): T => {
  try { return raw == null ? fallback : JSON.parse(raw) as T; } catch { return fallback; }
};

function effectiveBuiltinModel(model: BuiltinModel): BuiltinModel {
  if (!model.modelEnv) return model;
  const modelId = modelEnvName(model);
  return modelId === model.modelId ? model : { ...model, modelId, modelLabel: `${model.modelLabel} · ${modelId}` };
}

function priceOf(model: BuiltinModel) {
  if (model.price) return model.price;
  if (model.kind === "text") {
    const p = (pricing.llm as Record<string, Record<string, number | boolean>>)[model.providerId] ?? pricing.llm._default;
    return { ...p, verified: p.verified ?? false };
  }
  return { verified: false };
}

export function listProviderProfiles(): ProviderProfile[] {
  const overrides = new Map(all<OverrideRow>("SELECT * FROM model_profiles").map((r) => [`${r.provider_id}/${r.model_id}`, r]));
  const builtins = builtinModels.map((raw) => {
    const model = effectiveBuiltinModel(raw);
    const row = overrides.get(`${model.providerId}/${model.modelId}`) ?? overrides.get(`${raw.providerId}/${raw.modelId}`);
    const authConfigured = model.providerId === "google-gemini" ? !!geminiApiKey() : !!env(model.authEnv);
    const override = row && {
      enabled: !!row.enabled,
      price: parse(row.price, {}),
      defaults: parse(row.defaults, {}),
      limits: parse(row.limits, {}),
    };
    return {
      providerId: model.providerId,
      providerLabel: model.providerLabel,
      modelId: model.modelId,
      modelLabel: model.modelLabel,
      kind: model.kind,
      adapter: model.adapter,
      adapterStatus: model.adapterStatus,
      capabilities: model.capabilities,
      configured: authConfigured && (model.configEnvs ?? []).every((name) => !!env(name)) && enabledEnv(model.featureFlagEnv),
      enabled: override?.enabled ?? model.enabled,
      authEnv: model.authEnv,
      baseUrl: baseUrlOf(model),
      price: { ...priceOf(model), ...(override?.price ?? {}) },
      defaults: { ...(model.defaults ?? {}), ...(override?.defaults ?? {}) },
      limits: { ...(model.limits ?? {}), ...(override?.limits ?? {}) },
    } satisfies ProviderProfile;
  });
  const customs = customProviders().flatMap((provider) => customModels(provider.id).map((model) => ({
    providerId: `custom-${provider.id}`,
    providerLabel: provider.name,
    modelId: model.model_id,
    modelLabel: model.model_label,
    kind: model.kind,
    adapter: provider.interface_type,
    adapterStatus: "ready" as const,
    capabilities: model.kind === "image" ? [] : ["stream", "structured-output"] as const,
    configured: provider.enabled === 1 && customProviderConfigured(provider.id),
    enabled: model.enabled === 1,
    baseUrl: provider.base_url,
    price: { verified: false },
    defaults: {},
    limits: {},
    interfaceType: provider.interface_type,
    custom: true,
  } satisfies ProviderProfile)));
  return [...builtins, ...customs];
}

export function listTextModels() {
  return listProviderProfiles()
    .filter((p) => p.kind === "text" && p.adapterStatus === "ready" && p.configured && p.enabled)
    .map((p) => ({ id: p.custom ? `${p.providerId}::${p.modelId}` : p.providerId === "anthropic" ? "claude" : p.providerId, label: p.custom ? `${p.providerLabel} · ${p.modelLabel}` : p.providerLabel, model: p.modelId }));
}

export function getProviderProfile(providerId: string, modelId: string) {
  const normalizedProviderId = providerId === "claude" ? "anthropic" : providerId;
  return listProviderProfiles().find((p) => p.providerId === normalizedProviderId && p.modelId === modelId);
}

export function customTextModel(id: string) {
  const separator = id.indexOf("::");
  if (separator < 0) return undefined;
  const providerId = id.slice(0, separator);
  const modelId = id.slice(separator + 2);
  if (!providerId.startsWith("custom-")) return undefined;
  const provider = customProvider(providerId.slice("custom-".length));
  const model = provider ? customModels(provider.id).find((m) => m.model_id === modelId && m.kind === "text" && m.enabled === 1) : undefined;
  if (!provider || !model || provider.enabled !== 1 || !customProviderConfigured(provider.id)) return undefined;
  const apiKey = customProviderApiKey(provider.id);
  if (!apiKey) return undefined;
  return { id, providerId, providerDbId: provider.id, modelId, interfaceType: provider.interface_type, baseUrl: provider.base_url, apiKey };
}

export function customImageModel(id: string) {
  const separator = id.indexOf("::");
  if (separator < 0) return undefined;
  const providerId = id.slice(0, separator);
  const modelId = id.slice(separator + 2);
  if (!providerId.startsWith("custom-")) return undefined;
  const provider = customProvider(providerId.slice("custom-".length));
  const model = provider ? customModels(provider.id).find((m) => m.model_id === modelId && m.kind === "image" && m.enabled === 1) : undefined;
  if (!provider || !model || provider.interface_type !== "openai-compatible" || provider.enabled !== 1) return undefined;
  const apiKey = customProviderApiKey(provider.id);
  return apiKey ? { id, providerId, modelId, baseUrl: provider.base_url, apiKey } : undefined;
}

export function saveModelProfileOverride(input: ModelProfileOverride & { kind?: "text" | "image" }) {
  if (input.providerId.startsWith("custom-")) {
    const providerId = input.providerId.slice("custom-".length);
    if (input.kind) setCustomModelKind(providerId, input.modelId, input.kind);
    const model = input.enabled === undefined ? customModels(providerId).find((m) => m.model_id === input.modelId) : setCustomModelEnabled(providerId, input.modelId, input.enabled);
    return model ? getProviderProfile(input.providerId, input.modelId) : undefined;
  }
  const providerId = input.providerId === "claude" ? "anthropic" : input.providerId;
  const current = get<OverrideRow>("SELECT * FROM model_profiles WHERE provider_id = ? AND model_id = ?", providerId, input.modelId);
  const enabled = input.enabled ?? (current ? current.enabled !== 0 : true);
  run(
    `INSERT INTO model_profiles (provider_id, model_id, enabled, price, defaults, limits, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider_id, model_id) DO UPDATE SET enabled = excluded.enabled, price = excluded.price, defaults = excluded.defaults, limits = excluded.limits, updated_at = excluded.updated_at`,
    providerId,
    input.modelId,
    enabled ? 1 : 0,
    json(input.price ?? parse(current?.price, {})),
    json(input.defaults ?? parse(current?.defaults, {})),
    json(input.limits ?? parse(current?.limits, {})),
    Date.now(),
  );
  return getProviderProfile(providerId, input.modelId);
}
