"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ToastKind = "info" | "success" | "error";
type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type FeedbackContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  toast: (message: string, kind?: ToastKind) => void;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

type ToastItem = { id: number; message: string; kind: ToastKind };

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dialogRef = useRef(dialog);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => setDialog({ ...options, resolve }));
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = nextId.current++;
    setToasts((items) => [...items, { id, message, kind }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200);
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
      {dialog && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" role="presentation" onClick={() => finish(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111]/95 p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="confirm-title" className="text-base font-semibold text-white">{dialog.title}</h2>
            {dialog.message && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-white/60">{dialog.message}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => finish(false)}>{dialog.cancelLabel ?? "取消"}</button>
              <button className={`btn btn-sm ${dialog.tone === "danger" ? "border border-red-400/30 bg-red-400/15 text-red-100 hover:bg-red-400/25" : "btn-primary"}`} onClick={() => finish(true)}>{dialog.confirmLabel ?? "确定"}</button>
            </div>
          </div>
        </div>
      )}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[90] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur ${item.kind === "error" ? "border-red-400/25 bg-red-950/80 text-red-100" : item.kind === "success" ? "border-accent/25 bg-[#152000]/90 text-accent" : "border-white/10 bg-[#151515]/95 text-white/85"}`}>
            {item.message}
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
