"use client";

import { useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from "react";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        {hint && <span className="text-[11px] text-white/35">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** 随内容自动增高的 textarea；配合 max-h-* 使用时，超出部分在框内滚动 */
export function AutoTextarea({ value, className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.style.overflowY = el.scrollHeight > el.clientHeight + 1 ? "auto" : "hidden";
  }, [value]);
  return <textarea ref={ref} value={value} rows={1} className={`resize-none ${className}`} {...rest} />;
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

export function Select({ value, onChange, children, className = "" }: { value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input cursor-pointer appearance-none pr-9">
        {children}
      </select>
      <Icon name="chevron" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-white/40" />
    </div>
  );
}

const paths: Record<string, ReactNode> = {
  sparkle: <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h9" /></>,
  download: <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />,
  undo: <path d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3" />,
  arrow: <path d="M5 12h14m-5-5l5 5-5 5" />,
  check: <path d="M5 12l5 5 9-10" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  wand: <path d="M4 20L15 9M14 4v3M19 9h-3M17.5 5.5l-2 2M18 14v2M20 15h-4M8 3v2M9 4H7" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />,
};

export function Icon({ name, className = "size-4" }: { name: keyof typeof paths; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths[name]}
    </svg>
  );
}
