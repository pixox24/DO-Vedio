import type { PresetPayload, ProductionPreset } from "@/lib/core/preset";

export type PresetList = { presets: ProductionPreset[]; defaultId: string | null };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = (await res.json().catch(() => null)) as ({ error?: string } & Partial<T>) | null;
  if (!res.ok) throw new Error(data?.error ?? `请求失败（${res.status}）`);
  return data as T;
}

function jsonInit(method: "POST" | "PATCH", body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

const presetUrl = (id: string) => `/api/presets/${encodeURIComponent(id)}`;

export function fetchPresets() {
  return request<PresetList>("/api/presets");
}

export async function createPreset(input: { name: string; description?: string; payload: PresetPayload }) {
  const data = await request<{ preset: ProductionPreset }>("/api/presets", jsonInit("POST", input));
  return data.preset;
}

export async function updatePreset(id: string, patch: { name?: string; description?: string; payload?: PresetPayload }) {
  const data = await request<{ preset: ProductionPreset }>(presetUrl(id), jsonInit("PATCH", patch));
  return data.preset;
}

export async function deletePreset(id: string) {
  await request<{ ok: true }>(presetUrl(id), { method: "DELETE" });
}

export async function setPresetDefault(id: string) {
  const data = await request<{ defaultId: string }>(`${presetUrl(id)}/default`, { method: "POST" });
  return data.defaultId;
}

export async function clearPresetDefault(id: string) {
  const data = await request<{ defaultId: null }>(`${presetUrl(id)}/default`, { method: "DELETE" });
  return data.defaultId;
}
