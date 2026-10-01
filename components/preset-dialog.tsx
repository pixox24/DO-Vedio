"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Select, Spinner, Switch } from "@/components/ui";
import { useFeedback } from "@/components/feedback";
import { useModels } from "@/lib/client";
import {
  applyPresetToDoc,
  describePresetChanges,
  extractPresetPayload,
  presetGroupIds,
  presetGroupMeta,
  type PresetApplyContext,
  type PresetApplySelection,
  type PresetGroup,
  type ProductionPreset,
} from "@/lib/core/preset";
import { STUDIO_FONTS } from "@/lib/core/subtitle/fonts";
import type { ProjectDoc } from "@/lib/core/types";
import { clearPresetDefault, createPreset, deletePreset, fetchPresets, setPresetDefault, updatePreset, type PresetList } from "@/lib/presets-client";

type PresetStore = {
  doc: ProjectDoc | null;
  setDoc: (fn: (doc: ProjectDoc) => ProjectDoc) => void;
  /** useProject 的撤销栈；兼容没有 undo 的旧 store 替身 */
  undo?: () => void;
};

type VoiceCatalogLike = {
  providers: { id: string; models: { id: string; voices: { id: string }[] }[] }[];
};

const allGroups: PresetGroup[] = [...presetGroupIds];

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function formatTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * 制作预设选择区 —— 放在「制作设置」标题下方。
 * 负责列表加载、选择、当前状态判断，并打开应用/管理弹窗。
 */
export function PresetSection({ doc, store, catalog }: { doc: ProjectDoc; store: PresetStore; catalog: VoiceCatalogLike | null }) {
  const [list, setList] = useState<PresetList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [applyOpen, setApplyOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerFocusSave, setManagerFocusSave] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchPresets()
      .then((data) => {
        if (!alive) return;
        setList(data);
        setSelectedId((prev) => {
          if (prev && data.presets.some((preset) => preset.id === prev)) return prev;
          if (data.defaultId && data.presets.some((preset) => preset.id === data.defaultId)) return data.defaultId;
          return data.presets[0]?.id ?? null;
        });
      })
      .catch((reason) => {
        if (alive) setError(errorText(reason));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadToken]);

  const reload = () => {
    setLoading(true);
    setError("");
    setReloadToken((value) => value + 1);
  };

  const models = useModels();
  const context = useMemo<PresetApplyContext>(
    () => ({
      availableVoiceIds: catalog
        ? new Set(catalog.providers.flatMap((provider) => provider.models.flatMap((model) => model.voices.map((voice) => `${provider.id}::${model.id}::${voice.id}`))))
        : undefined,
      availableModelIds: models ? new Set(models.map((model) => model.id)) : undefined,
      availableFontIds: new Set(STUDIO_FONTS.filter((font) => font.bundled || !font.url).map((font) => font.id)),
    }),
    [catalog, models],
  );

  const presets = list?.presets ?? [];
  const preset = presets.find((item) => item.id === selectedId) ?? null;
  const changes = useMemo(() => (preset ? describePresetChanges(doc, preset.payload, { groups: allGroups }) : []), [doc, preset]);
  const isDefault = Boolean(preset && list?.defaultId === preset.id);

  const openManager = (focusSave: boolean) => {
    setManagerFocusSave(focusSave);
    setManagerOpen(true);
  };

  return (
    <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-white/85">制作预设</p>
          {isDefault && <span className="tag border-accent/30 bg-accent/10 text-accent">默认</span>}
        </div>
        {preset && (
          <span className={`text-xs ${changes.length === 0 ? "text-accent" : "text-amber-200/80"}`}>
            {changes.length === 0 ? "已应用" : `未应用 · ${changes.length} 项差异`}
          </span>
        )}
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-white/40">正在加载预设…</p>
      ) : error ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-red-300">
          {error}
          <button className="btn-text px-1 py-0 text-xs" onClick={reload}>重试</button>
        </p>
      ) : presets.length === 0 ? (
        <p className="mt-3 text-xs leading-5 text-white/45">还没有预设。把当前项目的全部制作设置与画面风格另存为预设，之后可一键复用。</p>
      ) : (
        <>
          <Select value={selectedId ?? ""} onChange={setSelectedId} className="mt-3" aria-label="选择制作预设">
            {presets.map((item) => (
              <option key={item.id} value={item.id}>{item.name}{item.id === list?.defaultId ? " · 默认" : ""}</option>
            ))}
          </Select>
          {preset?.description && <p className="mt-2 text-xs leading-5 text-white/40">{preset.description}</p>}
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn btn-primary btn-sm" disabled={!preset} onClick={() => setApplyOpen(true)}>应用</button>
        <button className="btn btn-ghost btn-sm" disabled={loading} onClick={() => openManager(true)}>另存为预设</button>
        <button className="btn btn-ghost btn-sm" onClick={() => openManager(false)}>管理</button>
      </div>

      {applyOpen && preset && <PresetApplyDialog preset={preset} doc={doc} store={store} context={context} onClose={() => setApplyOpen(false)} onApplied={reload} />}
      {managerOpen && (
        <PresetManagerDialog
          doc={doc}
          presets={presets}
          defaultId={list?.defaultId ?? null}
          focusSave={managerFocusSave}
          onClose={() => setManagerOpen(false)}
          onChanged={reload}
          onSaved={setSelectedId}
        />
      )}
    </div>
  );
}

/** 应用弹窗：勾选分组、查看差异与降级警告，确认后一次性套用到当前项目。 */
function PresetApplyDialog({ preset, doc, store, context, onClose, onApplied }: { preset: ProductionPreset; doc: ProjectDoc; store: PresetStore; context: PresetApplyContext; onClose: () => void; onApplied: () => void }) {
  const { toast } = useFeedback();
  const [groups, setGroups] = useState<PresetGroup[]>(allGroups);
  const [includeBudget, setIncludeBudget] = useState(false);

  const selection = useMemo<PresetApplySelection>(() => ({ groups, includeBudget }), [groups, includeBudget]);
  const changes = useMemo(() => describePresetChanges(doc, preset.payload, selection, context), [doc, preset, selection, context]);
  const dryRun = useMemo(() => applyPresetToDoc(doc, preset.payload, selection, context), [doc, preset, selection, context]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const toggleGroup = (group: PresetGroup) => {
    setGroups((prev) => (prev.includes(group) ? prev.filter((item) => item !== group) : [...prev, group]));
  };

  const apply = () => {
    if (groups.length === 0) {
      toast("请至少选择一个要应用的组", "info");
      return;
    }
    store.setDoc((current) => applyPresetToDoc(current, preset.payload, selection, context).doc);
    toast(`已应用预设「${preset.name}」`, "success", { label: "撤销", run: () => store.undo?.() });
    if (groups.includes("voice")) toast("配音设置已保存，将在下次生成配音时生效", "info");
    onApplied();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" role="presentation" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-white/10 bg-[#111]/95 shadow-2xl" role="dialog" aria-modal="true" aria-label={`应用预设 ${preset.name}`} onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-white/10 p-5">
          <h2 className="text-base font-semibold text-white">应用预设 · {preset.name}</h2>
          <p className="mt-1 text-xs leading-5 text-white/45">只覆盖勾选的组，未勾选的设置保持项目当前值；应用后可用提示里的「撤销」恢复。</p>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="space-y-2">
            {presetGroupIds.map((group) => (
              <div key={group} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" className="mt-0.5 size-4 cursor-pointer accent-[var(--accent)]" checked={groups.includes(group)} onChange={() => toggleGroup(group)} />
                  <span className="min-w-0">
                    <span className="block text-sm text-white/85">{presetGroupMeta[group].label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-white/40">{presetGroupMeta[group].hint}</span>
                  </span>
                </label>
                {group === "publish" && groups.includes("publish") && (
                  <label className="mt-2 ml-7 flex cursor-pointer items-center gap-2 text-xs text-white/55">
                    <Switch checked={includeBudget} label="同时覆盖预算上限" onChange={setIncludeBudget} />
                    同时覆盖预算上限（防止换预设意外改变花钱上限）
                  </label>
                )}
              </div>
            ))}
          </div>

          <div>
            <p className="label">将发生的变更</p>
            {changes.length === 0 ? (
              <p className="mt-2 text-sm text-white/45">与当前设置一致</p>
            ) : (
              <div className="mt-2 space-y-2">
                {changes.map((entry) => (
                  <div key={entry.group} className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
                    <p className="text-xs font-medium text-white/60">{entry.label}</p>
                    <ul className="mt-1.5 space-y-1 text-sm leading-5 text-white/75">
                      {entry.changes.map((text, index) => <li key={index} className="flex gap-2"><span className="text-white/25">·</span><span>{text}</span></li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          {dryRun.warnings.length > 0 && (
            <div className="rounded-xl border border-amber-300/25 bg-amber-300/10 p-3">
              <p className="text-xs font-medium text-amber-100/90">部分内容在当前环境不可用，将保留项目原值</p>
              <ul className="mt-1.5 space-y-1 text-xs leading-5 text-amber-100/75">
                {dryRun.warnings.map((warning, index) => <li key={index} className="flex gap-2"><span className="text-amber-100/40">·</span><span>{warning}</span></li>)}
              </ul>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-white/10 p-5">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>取消</button>
          <button className="btn btn-primary btn-sm" disabled={groups.length === 0} onClick={apply}>应用预设</button>
        </div>
      </div>
    </div>
  );
}

/** 管理弹窗：另存当前项目、列表管理（默认、重命名、复制、删除）。 */
function PresetManagerDialog({ doc, presets, defaultId, focusSave, onClose, onChanged, onSaved }: { doc: ProjectDoc; presets: ProductionPreset[]; defaultId: string | null; focusSave: boolean; onClose: () => void; onChanged: () => void; onSaved: (id: string) => void }) {
  const { confirm, toast } = useFeedback();
  const [name, setName] = useState("未命名预设");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSave) nameRef.current?.focus();
  }, [focusSave]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const saveNew = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast("请填写预设名称", "error");
      return;
    }
    setBusy("save");
    try {
      const created = await createPreset({ name: trimmed, description: description.trim() || undefined, payload: extractPresetPayload(doc) });
      toast(`预设「${created.name}」已保存`, "success");
      setName("未命名预设");
      setDescription("");
      onSaved(created.id);
      onChanged();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const makeDefault = async (preset: ProductionPreset) => {
    setBusy(`default:${preset.id}`);
    try {
      await setPresetDefault(preset.id);
      toast(`已将「${preset.name}」设为默认预设`, "success");
      onChanged();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const clearDefault = async (preset: ProductionPreset) => {
    setBusy(`default:${preset.id}`);
    try {
      await clearPresetDefault(preset.id);
      toast(`已取消「${preset.name}」的默认`, "success");
      onChanged();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const startRename = (preset: ProductionPreset) => {
    setEditingId(preset.id);
    setEditingName(preset.name);
  };

  const commitRename = async () => {
    if (!editingId) return;
    const trimmed = editingName.trim();
    if (!trimmed) {
      toast("名称不能为空", "error");
      return;
    }
    const current = presets.find((preset) => preset.id === editingId);
    if (current && current.name === trimmed) {
      setEditingId(null);
      return;
    }
    setBusy(`rename:${editingId}`);
    try {
      await updatePreset(editingId, { name: trimmed });
      toast("已重命名", "success");
      setEditingId(null);
      onChanged();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const copyPreset = async (preset: ProductionPreset) => {
    const existing = new Set(presets.map((item) => item.name));
    let copyName = `${preset.name} 副本`;
    let index = 2;
    while (existing.has(copyName)) {
      copyName = `${preset.name} 副本 ${index}`;
      index += 1;
    }
    setBusy(`copy:${preset.id}`);
    try {
      const created = await createPreset({ name: copyName, description: preset.description, payload: preset.payload });
      toast(`已复制为「${created.name}」`, "success");
      onSaved(created.id);
      onChanged();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (preset: ProductionPreset) => {
    if (!(await confirm({ title: `删除预设「${preset.name}」？`, message: "删除后不可恢复；已应用过该预设的项目不受影响。", confirmLabel: "删除预设", tone: "danger" }))) return;
    setBusy(`remove:${preset.id}`);
    try {
      await deletePreset(preset.id);
      toast("预设已删除", "success");
      onChanged();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const disabled = busy !== null;

  return (
    <div className="fixed inset-0 z-[95] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" role="presentation" onClick={() => { if (!disabled) onClose(); }}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-[#111]/95 shadow-2xl" role="dialog" aria-modal="true" aria-label="管理制作预设" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 p-5">
          <h2 className="text-base font-semibold text-white">管理制作预设</h2>
          <button className="btn-text" disabled={disabled} onClick={onClose} aria-label="关闭管理弹窗">关闭</button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="rounded-2xl border border-accent/20 bg-accent/[0.06] p-4">
            <p className="text-sm font-medium text-white/85">从当前项目另存为预设</p>
            <p className="mt-1 text-xs leading-5 text-white/45">记录全部制作设置与画面风格快照；不包含文案、角色、分镜、配乐编排与服务商密钥。</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
              <input ref={nameRef} className="input" value={name} maxLength={40} placeholder="预设名称" onChange={(event) => setName(event.target.value)} />
              <input className="input" value={description} maxLength={80} placeholder="描述（可选）" onChange={(event) => setDescription(event.target.value)} />
              <button className="btn btn-primary btn-sm h-10" disabled={disabled || !name.trim()} onClick={() => void saveNew()}>{busy === "save" ? <Spinner className="size-3" /> : null}保存</button>
            </div>
          </div>

          <div>
            <p className="label">已有预设 · {presets.length}</p>
            {presets.length === 0 ? (
              <p className="mt-2 text-sm text-white/45">还没有预设，先在上方保存一个。</p>
            ) : (
              <div className="mt-2 space-y-2">
                {presets.map((preset) => (
                  <div key={preset.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                    {editingId === preset.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input className="input h-9 min-h-9 min-w-0 flex-1 py-1.5 text-sm" value={editingName} maxLength={40} autoFocus onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void commitRename(); if (event.key === "Escape") setEditingId(null); }} />
                        <button className="btn btn-primary btn-sm" disabled={disabled} onClick={() => void commitRename()}>保存</button>
                        <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => setEditingId(null)}>取消</button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <p className="min-w-0 truncate text-sm text-white/85">{preset.name}</p>
                          {preset.id === defaultId && <span className="tag shrink-0 border-accent/30 bg-accent/10 text-accent">默认</span>}
                        </div>
                        {preset.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">{preset.description}</p>}
                        <p className="mt-1 text-[11px] text-white/35">更新于 {formatTime(preset.updatedAt)}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {preset.id === defaultId ? (
                            <button className="chip h-7 px-2.5" disabled={disabled} onClick={() => void clearDefault(preset)}>取消默认</button>
                          ) : (
                            <button className="chip h-7 px-2.5" disabled={disabled} onClick={() => void makeDefault(preset)}>设为默认</button>
                          )}
                          <button className="chip h-7 px-2.5" disabled={disabled} onClick={() => startRename(preset)}>重命名</button>
                          <button className="chip h-7 px-2.5" disabled={disabled} onClick={() => void copyPreset(preset)}>复制</button>
                          <button className="chip h-7 px-2.5 text-red-200/80 hover:text-red-100" disabled={disabled} onClick={() => void remove(preset)}>删除</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
