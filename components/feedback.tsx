"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Dialog } from "./ui";

type ToastKind = "info" | "success" | "error";
type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  /** 分条说明，用于「花多少 / 影响几步 / 能不能退」三要素 */
  bullets?: string[];
};
/** 轻提示上的操作按钮，例如重录之后的「撤销」 */
type ToastAction = { label: string; run: () => void | Promise<void> };

type FeedbackContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  toast: (message: string, kind?: ToastKind, action?: ToastAction) => void;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

type ToastItem = { id: number; message: string; kind: ToastKind; action?: ToastAction };

/** 带操作按钮的提示留久一点，够用户读完并点下去 */
const TOAST_MS = 4200;
const TOAST_WITH_ACTION_MS = 8000;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dialogRef = useRef(dialog);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => setDialog({ ...options, resolve }));
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = "info", action?: ToastAction) => {
    const id = nextId.current++;
    setToasts((items) => [...items, { id, message, kind, action }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), action ? TOAST_WITH_ACTION_MS : TOAST_MS);
  }, []);

  useEffect(() => {
    dialogRef.current = dialog;
  }, [dialog]);
  useEffect(() => () => dialogRef.current?.resolve(false), []);

  const value = useMemo(() => ({ confirm, toast }), [confirm, toast]);
  const finish = (result: boolean) => {
    if (!dialog) return;
    dialog.resolve(result);
    setDialog(null);
  };

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <Dialog
        open={dialog != null}
        onClose={() => finish(false)}
        title={dialog?.title ?? ""}
        description={dialog?.message ? <span className="whitespace-pre-line">{dialog.message}</span> : undefined}
        footer={
          <>
            <Button size="sm" onClick={() => finish(false)}>{dialog?.cancelLabel ?? "取消"}</Button>
            <Button size="sm" tone={dialog?.tone === "danger" ? "danger" : undefined} variant={dialog?.tone === "danger" ? "ghost" : "primary"} onClick={() => finish(true)}>
              {dialog?.confirmLabel ?? "确定"}
            </Button>
          </>
        }
      >
        {dialog?.bullets && dialog.bullets.length > 0 && (
          <ul className="space-y-1.5 text-sm leading-relaxed text-text-muted">
            {dialog.bullets.map((bullet, index) => <li key={index} className="flex gap-2"><span className="text-white/25">·</span><span>{bullet}</span></li>)}
          </ul>
        )}
      </Dialog>
      <div
        className="pointer-events-none fixed right-4 bottom-4 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
        style={{ zIndex: "var(--z-toast)" }}
        aria-live="polite"
      >
        {toasts.map((item) => (
          <div key={item.id} className={`pointer-events-auto flex animate-toast-in items-center gap-3 rounded-control border px-4 py-3 text-sm shadow-xl backdrop-blur ${item.kind === "error" ? "border-danger-border bg-red-950/80 text-danger" : item.kind === "success" ? "border-success-border bg-ink-raised/95 text-accent" : "border-line bg-ink-overlay/95 text-white/85"}`}>
            <span className="min-w-0 flex-1">{item.message}</span>
            {item.action && (
              <button
                className="shrink-0 rounded-md border border-current/30 px-2 py-1 text-xs font-medium hover:bg-white/10"
                onClick={() => { void item.action?.run(); setToasts((items) => items.filter((t) => t.id !== item.id)); }}
              >
                {item.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error("useFeedback must be used inside FeedbackProvider");
  return context;
}
