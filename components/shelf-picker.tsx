"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ShelfOption = { id: string; name: string; fit: string };

export function ShelfPicker({ label, value, locked, options, onAuto, onChange }: {
  label: string;
  value: string;
  locked: boolean;
  options: readonly ShelfOption[];
  onAuto: () => void;
  onChange: (id: string) => void;
}) {
  const current = options.find((item) => item.id === value) ?? options[0];
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ top: 0, left: 0, width: 0, above: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const updatePlacement = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    const roomBelow = window.innerHeight - rect.bottom - 16;
    const above = roomBelow < 220 && rect.top > roomBelow;
    setPlacement({ top: above ? rect.top - 8 : rect.bottom + 8, left, width, above });
  };

  useLayoutEffect(() => {
    if (open) updatePlacement();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open]);

  const menu = open && typeof document !== "undefined" ? createPortal(
    <div ref={menuRef} id={listId} role="listbox" aria-label={label} className={`select-menu ${placement.above ? "select-menu-above" : ""}`} style={{ top: placement.top, left: placement.left, width: placement.width }}>
      <button type="button" role="option" aria-selected={!locked} className="flex w-full flex-col items-start rounded-control px-3 py-2 text-left hover:bg-white/[0.08]" onClick={() => { onAuto(); setOpen(false); }}>
        <span className="text-sm text-white">自动</span>
        <span className="text-xs leading-5 text-white/45">按现在的规则配</span>
      </button>
      {options.map((item) => (
        <button key={item.id} type="button" role="option" aria-selected={locked && item.id === value} className="flex w-full flex-col items-start rounded-control px-3 py-2 text-left hover:bg-white/[0.08]" onClick={() => { onChange(item.id); setOpen(false); }}>
          <span className="text-sm text-white">{item.name}</span>
          <span className="text-xs leading-5 text-white/45">{item.fit}</span>
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="relative min-w-0">
      <button ref={triggerRef} type="button" className="select-trigger h-auto min-h-9 flex-col items-start gap-0 px-3 py-1.5" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((next) => !next)}>
        <span className="w-full truncate text-xs">{locked ? current?.name : `自动 · ${current?.name ?? ""}`}</span>
        {current && <span className="w-full truncate text-[10px] font-normal text-white/45">{current.fit}</span>}
      </button>
      {menu}
    </div>
  );
}
