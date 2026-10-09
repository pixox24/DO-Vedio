"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui";

export function SettingGroup({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-hairline py-5 first:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-text-secondary">{title}</h3>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function DisclosureRow({ label, value, open, onClick }: { label: string; value: string; open: boolean; onClick: () => void }) {
  return (
    <button type="button" className="mt-4 flex w-full items-center justify-between gap-3 border-t border-hairline pt-3 text-left text-sm transition hover:text-white" aria-expanded={open} onClick={onClick}>
      <span className="text-text-secondary">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-xs text-text-muted"><span className="truncate">{value}</span><Icon name="chevron" className={`size-3.5 shrink-0 transition ${open ? "rotate-180" : ""}`} /></span>
    </button>
  );
}

export function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-text">{label}</span>
      {children}
    </div>
  );
}
