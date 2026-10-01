import { randomUUID } from "crypto";
import { productionPresetSchema, type PresetPayload, type ProductionPreset } from "../core/preset";
import { all, get, json, parseJson, run, tx } from "./db";

/**
 * 制作预设存储：列表/增删改查 + app_meta 中的默认预设指针。
 * 预设是值快照，项目应用后与预设解耦，因此这里不做引用计数。
 */

type Row = { id: string; name: string; description: string; payload: string; created_at: number; updated_at: number };

const DEFAULT_KEY = "default_preset_id";

/** 读出的行经 schema 校验：payload 损坏或名称为空视为坏行，跳过而不是让整个列表报错 */
function toPreset(r: Row): ProductionPreset | undefined {
  const parsed = productionPresetSchema.safeParse({
    id: r.id,
    name: r.name.trim(),
    description: r.description,
    payload: parseJson(r.payload, null),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
  return parsed.success ? parsed.data : undefined;
}

export function listPresets(): ProductionPreset[] {
  return all<Row>("SELECT * FROM production_presets ORDER BY updated_at DESC")
    .map(toPreset)
    .filter((p): p is ProductionPreset => p !== undefined);
}

export function getPreset(id: string): ProductionPreset | undefined {
  const r = get<Row>("SELECT * FROM production_presets WHERE id = ?", id);
  return r ? toPreset(r) : undefined;
}

export function createPreset(input: { name: string; description?: string; payload: PresetPayload }): ProductionPreset {
  const now = Date.now();
  const preset = productionPresetSchema.parse({
    id: randomUUID(),
    name: input.name.trim(),
    description: input.description ?? "",
    payload: input.payload,
    createdAt: now,
    updatedAt: now,
  });
  run(
    "INSERT INTO production_presets (id, name, description, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    preset.id, preset.name, preset.description, json(preset.payload), preset.createdAt, preset.updatedAt,
  );
  return preset;
}

export function updatePreset(id: string, patch: { name?: string; description?: string; payload?: PresetPayload }): ProductionPreset | undefined {
  return tx(() => {
    const current = getPreset(id);
    if (!current) return undefined;
    const next = productionPresetSchema.parse({
      ...current,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.payload !== undefined ? { payload: patch.payload } : {}),
      updatedAt: Date.now(),
    });
    run(
      "UPDATE production_presets SET name = ?, description = ?, payload = ?, updated_at = ? WHERE id = ?",
      next.name, next.description, json(next.payload), next.updatedAt, id,
    );
    return next;
  });
}

export function deletePreset(id: string): boolean {
  return tx(() => {
    const deleted = run("DELETE FROM production_presets WHERE id = ?", id).changes > 0;
    if (deleted) run("DELETE FROM app_meta WHERE key = ? AND value = ?", DEFAULT_KEY, id);
    return deleted;
  });
}

export function getDefaultPresetId(): string | null {
  return get<{ value: string }>("SELECT value FROM app_meta WHERE key = ?", DEFAULT_KEY)?.value ?? null;
}

/** 设为默认；传 null 清除。id 不存在时抛错，由调用方转 404 */
export function setDefaultPreset(id: string | null): void {
  if (id === null) {
    run("DELETE FROM app_meta WHERE key = ?", DEFAULT_KEY);
    return;
  }
  if (!getPreset(id)) throw new Error("预设不存在");
  run(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    DEFAULT_KEY, id,
  );
}

/** 默认预设；指针悬空（预设已被手工删除）时清掉脏指针并返回 undefined */
export function getDefaultPreset(): ProductionPreset | undefined {
  const id = getDefaultPresetId();
  if (!id) return undefined;
  const preset = getPreset(id);
  if (preset) return preset;
  run("DELETE FROM app_meta WHERE key = ? AND value = ?", DEFAULT_KEY, id);
  return undefined;
}
