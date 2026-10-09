"use client";

import { createPortal } from "react-dom";
import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

/**
 * 共享原语。
 *
 * 约定：组件只负责「结构与行为」，视觉一律走 globals.css 的 .btn/.chip/.alert/.overlay
 * 等语义类，不要再在调用处手写颜色/圆角魔数。
 * 新增颜色、圆角、层级前先看 app/globals.css 顶部的 @theme 有没有可复用的令牌。
 */

type Tone = "default" | "warn" | "danger" | "info" | "success";

/**
 * 按钮。原来全站 111 处手写 "btn btn-ghost btn-sm" 字符串，
 * 且每个 loading 按钮都要自己抄一遍 <Spinner/>，这里一并收掉。
 */
export function Button({
  variant = "ghost",
  size = "md",
  tone,
  loading = false,
  icon,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "text";
  size?: "sm" | "md";
  tone?: Tone;
  loading?: boolean;
  icon?: ReactNode;
}) {
  const variantClass = tone && tone !== "default" ? `btn-${tone}` : `btn-${variant}`;
  const classes = ["btn", variantClass, size === "sm" && "btn-sm", className].filter(Boolean).join(" ");
  return (
    <button {...rest} className={classes} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading ? <Spinner className="size-3.5" /> : icon}
      {children}
    </button>
  );
}

/** 语义横幅：原来错了 12 处各自漂移的 amber/red 边框透明度。 */
export function Alert({
  tone = "info",
  size = "md",
  role,
  className = "",
  actions,
  children,
}: {
  tone?: Tone;
  size?: "sm" | "md";
  role?: "alert" | "status";
  className?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const resolvedRole = role ?? (tone === "danger" || tone === "warn" ? "alert" : undefined);
  return (
    <div role={resolvedRole} className={`alert alert-${tone} ${size === "sm" ? "alert-sm" : ""} ${className}`}>
      <span className="min-w-0">{children}</span>
      {actions && <span className="flex shrink-0 flex-wrap items-center gap-2">{actions}</span>}
    </div>
  );
}

/** 卡片容器，等价于 .panel，但带标题区与可选操作。 */
export function Card({
  title,
  label,
  description,
  actions,
  className = "",
  bodyClassName = "",
  children,
}: {
  title?: ReactNode;
  label?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  const hasHeader = title != null || label != null || description != null || actions != null;
  return (
    <section className={`panel ${className}`}>
      {hasHeader && (
        <header className="flex flex-wrap items-start justify-between gap-3 p-5 pb-0">
          <div className="min-w-0">
            {label && <p className="label">{label}</p>}
            {title && <h2 className="mt-1 text-base font-medium">{title}</h2>}
            {description && <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName || (hasHeader ? "p-5" : "")}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        {hint && <span className="text-2xs text-text-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/**
 * 弹窗原语。替换原来 4 套互不兼容的实现
 * （feedback / preset-dialog / project-list / version-history）：
 * 它们各写一遍 Esc、点遮罩关闭、role=dialog，且 z-index 从 40 到 100 各不相同，
 * 其中 project-list 的 z-40 会被页头（同为 z-40）盖住。
 *
 * 这里统一：portal 到 body、z 层级、入场动画、焦点管理、Esc、遮罩点击。
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  size = "md",
  footer,
  className = "",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  size?: "sm" | "md" | "lg";
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `dialog-title-${useId().replaceAll(":", "")}`;
  const descId = `dialog-desc-${useId().replaceAll(":", "")}`;

  // Esc 关闭 + 打开时把焦点移进弹窗
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const width = size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-md";

  return createPortal(
    <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`overlay-panel ${width} max-h-[85vh] overflow-y-auto ${className}`}
      >
        <h2 id={titleId} className="text-base font-semibold text-white">{title}</h2>
        {description && <p id={descId} className="mt-2 text-sm leading-relaxed text-text-muted">{description}</p>}
        {children && <div className="mt-4">{children}</div>}
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * 抽屉（右侧滑出）。原来 version-history 自成一派，
 * 与弹窗共用遮罩与 z 层级，但保持右对齐与整高。
 */
export function Drawer({
  open,
  onClose,
  title,
  width = "max-w-md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  width?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="overlay" style={{ placeItems: "stretch", justifyContent: "flex-end" }} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        className={`h-full w-full ${width} overflow-y-auto rounded-l-[var(--radius-panel)] border-l border-line bg-ink-raised/95 p-6 shadow-2xl`}
        style={{ animation: "var(--animate-drawer-in)" }}
      >
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button type="button" className="btn-text" onClick={onClose} aria-label="关闭">
            <Icon name="stop" className="size-3.5" />
          </button>
        </header>
        <div className="mt-5">{children}</div>
      </div>
    </div>,
    document.body,
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

type SelectOption = { value: string; label: ReactNode; disabled?: boolean };

function readOptions(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === "option") {
      const props = child.props as { value?: string | number; disabled?: boolean; children?: ReactNode };
      options.push({ value: String(props.value ?? props.children ?? ""), label: props.children, disabled: props.disabled });
      return;
    }
    if (child.type === Fragment) options.push(...readOptions((child.props as { children?: ReactNode }).children));
  });
  return options;
}

export function Select({ value, onChange, children, className = "", disabled = false, "aria-label": ariaLabel }: { value: string; onChange: (v: string) => void; children: ReactNode; className?: string; disabled?: boolean; "aria-label"?: string }) {
  const options = readOptions(children);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0);
  const [placement, setPlacement] = useState({ top: 0, left: 0, width: 0, above: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `select-${useId().replaceAll(":", "")}`;
  const current = options[selectedIndex] ?? options[0];

  const updatePlacement = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 24);
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
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
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

  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  const moveActive = (direction: 1 | -1) => {
    if (!options.length) return;
    let next = activeIndex;
    for (let i = 0; i < options.length; i += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next].disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && !open) {
      event.preventDefault();
      setOpen(true);
    }
  };

  const menu = open && typeof document !== "undefined" ? createPortal(
    <div
      ref={menuRef}
      id={menuId}
      role="listbox"
      aria-label={ariaLabel}
      className={`select-menu ${placement.above ? "select-menu-above" : ""}`}
      style={{ top: placement.top, left: placement.left, width: placement.width }}
    >
      {options.length ? options.map((option, index) => (
        <button
          key={`${option.value}-${index}`}
          type="button"
          role="option"
          aria-selected={option.value === value}
          disabled={option.disabled}
          className="select-option"
          data-active={index === activeIndex}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => choose(option)}
        >
          <span className="min-w-0 truncate">{option.label}</span>
          {option.value === value && <Icon name="check" className="size-3.5 shrink-0 text-accent" />}
        </button>
      )) : <span className="block px-3 py-2 text-xs text-white/35">暂无选项</span>}
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`select-trigger ${className}`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          if (!disabled) {
            setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
            setOpen((currentOpen) => !currentOpen);
          }
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={`min-w-0 truncate ${current ? "" : "text-white/35"}`}>{current?.label ?? "请选择"}</span>
        <Icon name="chevron" className={`size-4 shrink-0 text-white/40 transition-transform ${open ? "rotate-180 text-accent" : ""}`} />
      </button>
      {menu}
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

const previewChannels = new Map<string, Set<(token: number) => void>>();
let previewToken = 0;

/** 同一 channel 里后开始的试听会停掉正在播的那一个。 */
function claimPreview(channel: string, token: number) {
  previewChannels.get(channel)?.forEach((stop) => stop(token));
}

export function AudioButton({ src, startMs = 0, endMs, label = "试听", ariaLabel, channel }: { src: string; startMs?: number; endMs?: number; label?: string; ariaLabel?: string; channel?: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const token = useRef(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    const onEnded = () => setPlaying(false);
    element.addEventListener("ended", onEnded);
    if (!channel) return () => element.removeEventListener("ended", onEnded);
    const stop = (next: number) => {
      if (next === token.current) return;
      element.pause();
      setPlaying(false);
    };
    const group = previewChannels.get(channel) ?? new Set<(next: number) => void>();
    group.add(stop);
    previewChannels.set(channel, group);
    return () => {
      element.removeEventListener("ended", onEnded);
      element.pause();
      group.delete(stop);
      if (group.size === 0) previewChannels.delete(channel);
    };
  }, [channel]);
  async function toggle() {
    const element = audio.current;
    if (!element) return;
    if (playing) {
      element.pause();
      setPlaying(false);
      return;
    }
    token.current = ++previewToken;
    if (channel) claimPreview(channel, token.current);
    element.currentTime = startMs / 1000;
    setPlaying(true);
    await element.play().catch(() => setPlaying(false));
  }
  return (
    <>
      <button type="button" className="audio-button" data-playing={playing ? "true" : undefined} onClick={toggle} aria-pressed={playing} aria-label={playing ? `暂停${ariaLabel ?? label}` : (ariaLabel ?? label)}>
        {playing ? <span className="audio-eq" aria-hidden="true"><span /><span /><span /></span> : <Icon name="play" className="size-3.5" />} {playing ? "暂停" : label}
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
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
  alert: <><path d="M12 4l9 16H3L12 4z" /><path d="M12 10v4.5M12 17.2v.1" /></>,
  /* 制作页面板选项卡图标（PanelTabs 使用） */
  sliders: <><path d="M4 7h8M16 7h4M4 12h4M12 12h8M4 17h10M18 17h2" /><circle cx="14" cy="7" r="2.2" /><circle cx="10" cy="12" r="2.2" /><circle cx="16" cy="17" r="2.2" /></>,
  text: <path d="M4 6.5h16M4 12h16M4 17.5h9" />,
  user: <><circle cx="12" cy="9" r="3.2" /><path d="M5.5 19.5c1.2-3 3.6-4.5 6.5-4.5s5.3 1.5 6.5 4.5" /></>,
  frames: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 12h18M9 5v14M15 5v14" /></>,
  palette: <><circle cx="12" cy="12" r="8.5" /><circle cx="9.2" cy="10.2" r="1.7" /><circle cx="12.6" cy="8.4" r="1.7" /><circle cx="15.4" cy="11.2" r="1.7" /></>,
  captions: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7.5 12h3M13.5 12h3" /></>,
  music: <><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0012 0M12 17v4M8 21h8" /></>,
};

export function Icon({ name, className = "size-4" }: { name: keyof typeof paths; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {paths[name]}
    </svg>
  );
}
