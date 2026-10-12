"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motionById, motionChoices } from "@/lib/core/motion-library";
import type { FocusPresetId } from "@/lib/core/types";

export function MotionPresetPicker({ text, value, onChange }: { text: string; value: FocusPresetId; onChange: (id: FocusPresetId) => void }) {
  const choices = motionChoices(text);
  const current = motionById(value) ?? choices[0]?.item;
  const mismatch = choices.find((choice) => choice.item.id === value)?.mismatch ?? false;
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ top: 0, left: 0, width: 0, above: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const updatePlacement = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    const roomBelow = window.innerHeight - rect.bottom - 16;
    const above = roomBelow < 240 && rect.top > roomBelow;
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
    <div ref={menuRef} id={listId} role="listbox" aria-label="排版方案" className={`select-menu ${placement.above ? "select-menu-above" : ""}`} style={{ top: placement.top, left: placement.left, width: placement.width }}>
      {choices.map(({ item, mismatch: bad }) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={item.id === value}
          className="flex w-full flex-col items-start rounded-control px-3 py-2 text-left hover:bg-white/[0.08]"
          onClick={() => {
            onChange(item.id);
            setOpen(false);
          }}
        >
          <span className="text-sm text-white">{item.name}{bad ? " · 字宽不合" : ""}</span>
          <span className="text-xs leading-5 text-white/45">{item.fit}</span>
        </button>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        className="select-trigger h-auto min-h-9 flex-col items-start gap-0 px-3 py-1.5"
        aria-label="排版方案"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((next) => !next)}
      >
        <span className="w-full truncate text-xs">{current?.name ?? "圆点与聚焦"}{mismatch ? " · 字宽不合" : ""}</span>
        {current && <span className="w-full truncate text-[10px] font-normal text-white/45">{current.fit}</span>}
      </button>
      {menu}
    </div>
  );
}
