"use client";

import { Icon, Select } from "@/components/ui";
import { focusPresetLabels, recommendedMotionPalette } from "@/lib/core/focus";
import { motionCatalog } from "@/lib/core/motion-library";
import { focusPresetIds, type FocusPresetId, type MotionPalette } from "@/lib/core/types";

const roles = [
  { id: "opening", label: "开场" },
  { id: "statement", label: "观点" },
  { id: "number", label: "数字" },
] as const;

function dedupe(ids: readonly FocusPresetId[]) {
  return focusPresetIds.filter((id) => ids.includes(id)).slice(0, 3);
}

export function MotionPaletteEditor({ palette, onChange }: { palette: MotionPalette | null; onChange: (next: MotionPalette | null) => void }) {
  const active = !!palette && roles.some((role) => palette[role.id].length > 0);

  function update(role: (typeof roles)[number]["id"], ids: FocusPresetId[]) {
    const next = {
      opening: palette?.opening ?? [],
      statement: palette?.statement ?? [],
      number: palette?.number ?? [],
      [role]: dedupe(ids),
    };
    onChange(roles.some((item) => next[item.id].length > 0) ? next : null);
  }

  const current = palette ?? { opening: [], statement: [], number: [] };
  const summary = active
    ? roles.flatMap((role) => current[role.id].length ? [`${role.label} ${current[role.id].map((id) => focusPresetLabels[id]).join("、")}`] : []).join(" · ")
    : "智能匹配";

  return (
    <details className="group mt-4 border-t border-white/10 pt-4">
      <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
        <span className="label shrink-0">全局动画设置</span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-white/45">{summary}</span>
        <Icon name="chevron" className="size-3.5 shrink-0 text-white/40 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3 flex justify-end">
        {active ? (
          <button type="button" className="chip h-7 px-2.5 text-xs" onClick={() => onChange(null)}>改回智能匹配</button>
        ) : (
          <button type="button" className="chip chip-on h-7 px-2.5 text-xs" onClick={() => onChange(recommendedMotionPalette)}>用推荐盘</button>
        )}
      </div>
      <div className="mt-3 space-y-2">
        {roles.map((role) => {
          const chosen = current[role.id];
          const remaining = motionCatalog.filter((item) => !chosen.includes(item.id));
          return (
            <div key={role.id} className="flex flex-wrap items-center gap-1.5">
              <span className="w-10 text-xs text-white/45">{role.label}</span>
              {chosen.map((id) => (
                <button key={id} type="button" className="chip chip-on h-7 px-2 text-xs" aria-label={`移出${focusPresetLabels[id]}`} onClick={() => update(role.id, chosen.filter((item) => item !== id))}>
                  {focusPresetLabels[id]}
                </button>
              ))}
              {chosen.length < 3 && remaining.length > 0 && (
                <Select className="h-7 w-36 min-w-0 py-0 text-xs" value="" aria-label={`添加${role.label}动画`} onChange={(id) => update(role.id, [...chosen, id as FocusPresetId])}>
                  <option value="">添加</option>
                  {remaining.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-5 text-white/40">{active ? "有数字的镜头用数字。前 15 秒的其他重点文字用开场，其余用观点。某一格空着时，用已选的其他动画。单镜手动锁定不受这里限制。" : "默认不用设置。智能匹配和探索变化会在 20 条里挑，只在想给整部片子指定动画时再改。"}</p>
    </details>
  );
}
