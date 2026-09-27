"use client";

import { useEffect } from "react";

export function isEditableTarget(target: EventTarget | null) {
  return target instanceof Element && (Boolean(target.closest("input, textarea, select")) || (target instanceof HTMLElement && target.isContentEditable));
}

export function useProjectShortcuts(actions: { save: () => void; undo: () => void; previous?: () => void; next?: () => void; togglePlay?: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "s") { event.preventDefault(); actions.save(); }
      else if (isEditableTarget(event.target)) return;
      else if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); actions.undo(); }
      else if (!mod && !event.altKey && event.code === "Space" && actions.togglePlay) { event.preventDefault(); actions.togglePlay(); }
      else if (!mod && !event.altKey && event.key.toLowerCase() === "j") actions.previous?.();
      else if (!mod && !event.altKey && event.key.toLowerCase() === "k") actions.next?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);
}
