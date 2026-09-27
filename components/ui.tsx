"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";

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
export function AutoTextarea({ value, className = "", inputRef, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; inputRef?: (el: HTMLTextAreaElement | null) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.style.overflowY = el.scrollHeight > el.clientHeight + 1 ? "auto" : "hidden";
  }, [value]);
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        inputRef?.(el);
      }}
      value={value}
      rows={1}
      className={`resize-none ${className}`}
      {...rest}
    />
  );
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

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" data-checked={checked} onClick={() => onChange(!checked)}>
      <span className="switch-thumb" />
    </button>
  );
}

export function SegmentedControl<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; label?: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className={`segmented-item ${value === option.value ? "segmented-item-active" : ""}`} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function RangeField({ value, min, max, step, onChange, label, suffix = "" }: { value: number; min: number; max: number; step: number; onChange: (value: number) => void; label: string; suffix?: string }) {
  return (
    <label className="flex min-w-0 items-center gap-3 text-sm text-text-muted">
      <span className="shrink-0">{label}</span>
      <input className="range min-w-0 flex-1" type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="w-12 shrink-0 text-right tabular-nums text-white/65">{value}{suffix}</span>
    </label>
  );
}

export function AudioButton({ src, startMs = 0, endMs, label = "试听" }: { src: string; startMs?: number; endMs?: number; label?: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    const onEnded = () => setPlaying(false);
    element.addEventListener("ended", onEnded);
    return () => element.removeEventListener("ended", onEnded);
  }, []);
  async function toggle() {
    const element = audio.current;
    if (!element) return;
    if (playing) {
      element.pause();
      setPlaying(false);
      return;
    }
    element.currentTime = startMs / 1000;
    setPlaying(true);
    await element.play().catch(() => setPlaying(false));
  }
  return (
    <>
      <button type="button" className="audio-button" onClick={toggle} aria-label={playing ? "暂停试听" : label}>
        <Icon name={playing ? "pause" : "play"} className="size-3.5" /> {playing ? "暂停" : label}
      </button>
      <audio ref={audio} preload="metadata" className="hidden" src={src} onTimeUpdate={(event) => { if (endMs != null && event.currentTarget.currentTime * 1000 >= endMs) { event.currentTarget.pause(); setPlaying(false); } }} />
    </>
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
  play: <path d="M8 5v14l11-7z" />,
  pause: <><path d="M8 5v14" /><path d="M16 5v14" /></>,
  search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="M15 15l4.5 4.5" /></>,
  bolt: <path d="M13 3L5 13h6l-1 8 8-10h-6l1-8z" />,
  bug: <><rect x="7" y="7" width="10" height="11" rx="4" /><path d="M7 11H4M20 11h-3M7 15H4M20 15h-3M9 6L7.5 4M15 6l1.5-2" /></>,
  server: <><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></>,
};

export function Icon({ name, className = "size-4" }: { name: keyof typeof paths; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths[name]}
    </svg>
  );
}
