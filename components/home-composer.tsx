"use client";

import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Alert, Icon, Spinner } from "@/components/ui";
import DotGrid from "@/components/DotGrid";
import { useFeedback } from "@/components/feedback";
import { postJson } from "@/lib/client";
import { emptyDoc, type Project } from "@/lib/core/types";
import { storeViralReference } from "@/components/viral/entry";

/**
 * 首页输入区。
 *
 * 三个模式共用一个输入框，因为三者的用户动作是同一个 —— 把一段文字交出去，
 * 区别只在「这段文字被如何理解」。差异收进模式选择，而不是做三个入口。
 *
 * 模式①等价于原来 project-list 里的「新建项目」弹窗，
 * 走同一个接口，因此服务端自动套用默认制作预设这条行为原样保留，首页不需要感知预设。
 *
 * 模式②暂为占位；爆款复创将参考稿带到独立页面，入口不会调用文字模型。
 */

type ModeKey = "title" | "script" | "viral";

type Mode = {
  key: ModeKey;
  label: string;
  icon: "text" | "copy" | "bolt";
  /** 菜单里的一句话说明，回答「这个模式把这段文字理解成什么」 */
  hint: string;
  placeholder: string;
  /** 输入框下方的小字，随模式切换并交叉淡入；为空则该行不渲染 */
  note?: string;
  /** 没有真实实现，提交时只提示开发中 */
  pending?: boolean;
  /** 是否把回车让给换行。标题不含换行，所以它独占回车 */
  multiline: boolean;
  examples: string[];
};

const modes: Mode[] = [
  {
    key: "title",
    label: "输入标题",
    icon: "text",
    hint: "给个题目，AI 从零写稿",
    placeholder: "例如：为什么年轻人开始逃离大城市？",
    multiline: false,
    examples: ["为什么年轻人开始逃离大城市？", "房租吃掉工资的三成", "远程办公三年后，我搬回了老家"],
  },
  {
    key: "script",
    label: "输入已有文案",
    icon: "copy",
    hint: "稿子已经写好，直接进入制作",
    placeholder: "把写好的文案粘贴到这里，直接从断句标注开始",
    note: "回车换行 · ⌘/Ctrl 回车提交 · 功能开发中",
    pending: true,
    multiline: true,
    examples: ["把公众号那篇稿子贴进来", "已经有逐字稿，跳过写稿这一步"],
  },
  {
    key: "viral",
    label: "爆款复创",
    icon: "bolt",
    hint: "借鉴表达机制，写出自己的口播稿",
    placeholder: "粘贴想借鉴的口播文案",
    note: "回车换行 · ⌘/Ctrl 回车进入 · 也可先进入再粘贴",
    multiline: true,
    examples: [],
  },
];

/** 首屏分批入场的节奏：标题 → 输入框 → 辅助小字 → 示例 */
const STAGGER_MS = 90;

export function HomeComposer() {
  const router = useRouter();
  const { toast } = useFeedback();
  const [mode, setMode] = useState<ModeKey>("title");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  /** 菜单挂到 body 上，定位基准是触发器元素本身，所以用 state 存而不是读 ref */
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);

  const current = modes.find((item) => item.key === mode) ?? modes[0];
  const trimmed = value.trim();
  const canSubmit = (mode === "viral" || trimmed.length > 0) && !busy;

  /**
   * 从列表页的「新建项目」跳回来时聚焦输入框。
   * 用一次性 sessionStorage 标记，而不是 `?focus=1`：读查询串的 useSearchParams
   * 会把整棵客户端树拖进最近的 Suspense 边界做 CSR（Next 16 的行为），
   * 首页不值得为此付这个代价。
   */
  useEffect(() => {
    try {
      if (sessionStorage.getItem("do-vedio:focus-composer") !== "1") return;
      sessionStorage.removeItem("do-vedio:focus-composer");
      textareaRef.current?.focus();
    } catch {}
  }, []);

  // 随内容增高；上限由 .composer-text 的 max-h 给出，超出后框内滚动
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.style.overflowY = el.scrollHeight > el.clientHeight + 1 ? "auto" : "hidden";
  }, [value, mode]);

  const submit = useCallback(async () => {
    if (!canSubmit) return;

    if (current.key === "viral") {
      setError("");
      try { storeViralReference(value); router.push("/viral"); }
      catch { setError("浏览器暂时无法带入参考稿，请通过顶部「爆款复创」进入后粘贴"); }
      return;
    }

    if (current.pending) {
      toast("这个功能还在开发中，先记下了", "info");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const base = emptyDoc();
      const project = await postJson<Project>("/api/projects", {
        doc: { ...base, brief: { ...base.brief, title: trimmed } },
      });
      // 跳转期间保持 busy，避免按钮在离开前回弹一下
      router.push(`/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [canSubmit, current.key, current.pending, trimmed, value, toast, router]);

  /** 标题独占回车（它不含换行）；多行模式用 ⌘/Ctrl 回车提交 */
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || menuOpen) return;
    if (!current.multiline) {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      void submit();
    }
  };

  /** 示例点击后填入并聚焦；壳子闪一下，让「文字是从这里进去的」有落点 */
  const pickExample = (text: string) => {
    setValue(text);
    textareaRef.current?.focus();
    const shell = shellRef.current;
    if (!shell) return;
    shell.classList.remove("composer-flash");
    void shell.offsetWidth; // 强制回流，否则同一条动画不会重播
    shell.classList.add("composer-flash");
  };

  return (
    <div className="relative flex min-h-[calc(100vh-9rem)] items-center justify-center py-10">
      <div className="relative z-10 w-full max-w-2xl">
        <header className="composer-enter text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1 text-2xs tracking-wide text-text-muted">
            <span aria-hidden="true" className="animate-live-dot size-1.5 rounded-full bg-accent" />
            AI 视频文案工坊
          </span>
          <h1 className="mt-5 bg-gradient-to-b from-white to-white/70 bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-5xl">
            从哪里开始？
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-muted">给一个标题，剩下交给这条生产线。</p>
        </header>

        <div className="relative mt-9">
          {/* 点阵只铺在输入框周边，靠 fade 往外淡出；不做整屏背景 */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-x-10 -inset-y-16 z-0 sm:-inset-x-20 sm:-inset-y-24"
          >
            <DotGrid
              baseColor="#2e2e2e"
              activeColor="#cdff3a"
              dotSize={2}
              gap={20}
              proximity={150}
              strength={0.5}
              bounce={0.25}
              tension={0.35}
              returnDuration={0.9}
              shockRadius={220}
              shockStrength={4}
              swell={0.5}
              stretch={0.3}
              glow={0.35}
              fade={0.6}
              opacity={0.5}
            />
          </div>

          <div ref={shellRef} className="composer-shell composer-enter relative z-10" style={{ animationDelay: `${STAGGER_MS}ms` }}>
            <label className="sr-only" htmlFor="home-composer-input">
              {current.label}
            </label>
            <textarea
              id="home-composer-input"
              ref={textareaRef}
              rows={1}
              value={value}
              readOnly={busy}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={current.placeholder}
              className="composer-text max-h-64 overflow-y-hidden"
              aria-describedby="home-composer-note"
            />

            <div className="flex items-center justify-between gap-3 px-3.5 py-3">
              <ModeTrigger
                triggerRef={(el) => {
                  triggerRef.current = el;
                  setAnchor(el);
                }}
                mode={current}
                open={menuOpen}
                disabled={busy}
                onToggle={() => setMenuOpen((open) => !open)}
              />

              <div className="flex min-w-0 items-center gap-3">
                {busy && <span className="hidden text-xs text-text-faint sm:inline">正在创建…</span>}
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!canSubmit}
                  aria-busy={busy || undefined}
                  aria-label={current.key === "viral" ? "进入爆款复创" : current.pending ? "提交（功能开发中）" : "创建项目"}
                  className="composer-send"
                  data-busy={busy ? "true" : undefined}
                >
                  {busy ? <Spinner className="size-4" /> : (
                    <span className="composer-send-icon">
                      <Icon name="arrow" className="size-4 -rotate-90" />
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <Alert
            tone="danger"
            size="sm"
            className="mt-3"
            actions={
              <button type="button" className="btn-text text-xs" onClick={() => void submit()}>
                重试
              </button>
            }
          >
            {error}
          </Alert>
        )}

        {menuOpen && (
          <ModeMenu
            anchor={anchor}
            value={mode}
            onPick={(next) => {
              setMode(next);
              setMenuOpen(false);
              textareaRef.current?.focus();
            }}
            onClose={() => setMenuOpen(false)}
          />
        )}

        {current.note && (
          <div
            id="home-composer-note"
            aria-live="polite"
            className="composer-enter mt-4 px-1"
            style={{ animationDelay: `${STAGGER_MS * 2}ms` }}
          >
            <p key={current.key} className="composer-note text-xs leading-relaxed text-text-faint">
              {current.note}
            </p>
          </div>
        )}

        <div className="mt-7 flex flex-wrap justify-center gap-2">
          {current.examples.map((example, index) => (
            <span
              key={`${current.key}-${example}`}
              className="composer-enter inline-flex"
              style={{ animationDelay: `${STAGGER_MS * 3 + index * 60}ms` }}
            >
              <button type="button" className="composer-chip" onClick={() => pickExample(example)}>
                {example}
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 模式触发器：紧凑 pill；键盘上下键打开菜单后焦点交给菜单 */
function ModeTrigger({
  triggerRef,
  mode,
  open,
  disabled,
  onToggle,
}: {
  triggerRef: (el: HTMLButtonElement | null) => void;
  mode: Mode;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      disabled={disabled}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onToggle}
      onKeyDown={(event) => {
        if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !open) {
          event.preventDefault();
          onToggle();
        }
      }}
      className="composer-mode"
    >
      <Icon name={mode.icon} className="size-3.5 text-accent/80" />
      {mode.label}
      <Icon name="chevron" className={`size-3.5 text-white/40 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

/**
 * 模式菜单。滑块指示器随选中项滑动；方向键移动、回车选中、Esc 与点外收起。
 * 定位与键盘处理沿用 components/ui.tsx 里 Select 的那套做法，保持两处一致。
 */
function ModeMenu({
  anchor,
  value,
  onPick,
  onClose,
}: {
  anchor: HTMLButtonElement | null;
  value: ModeKey;
  onPick: (key: ModeKey) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, modes.findIndex((item) => item.key === value)));
  const [marker, setMarker] = useState({ top: 0, height: 0 });
  const [above, setAbove] = useState(false);
  const [placement, setPlacement] = useState({ top: 0, left: 0, width: 320 });

  const updatePlacement = useCallback(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    const roomBelow = window.innerHeight - rect.bottom - 16;
    // 菜单比触发器高得多，下方放不下且上方更宽裕时才往上翻
    const flip = roomBelow < 320 && rect.top > roomBelow;
    setAbove(flip);
    setPlacement({ top: flip ? rect.top - 8 : rect.bottom + 8, left, width });
  }, [anchor]);

  /*
   * 定位与滑块尺寸都要在 DOM 量出来之后才能算，因此放在 layout effect 里写 state。
   * 这是「量 DOM 再回填」的必要往返，不是可以从渲染里推导出来的值。
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [updatePlacement]);

  // 滑块贴着选中项；用相对菜单 padding 盒的矩形测量，避免与内边距/边框叠加而错位
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const item = itemRefs.current[activeIndex];
    if (!menu || !item) return;
    const menuRect = menu.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    setMarker({ top: itemRect.top - menuRect.top - menu.clientTop, height: itemRect.height });
  }, [activeIndex, placement.width]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 打开后焦点交给当前项，键盘接手；preventScroll 避免页面被拽动
  useEffect(() => {
    itemRefs.current[activeIndex]?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !anchor?.contains(target)) onClose();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      anchor?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, onClose]);

  const move = (direction: 1 | -1) => {
    setActiveIndex((index) => (index + direction + modes.length) % modes.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPick(modes[activeIndex].key);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="输入模式"
      className="mode-menu"
      onKeyDown={onKeyDown}
      style={{
        top: placement.top,
        left: placement.left,
        width: placement.width,
        transform: above ? "translateY(-100%)" : undefined,
      }}
    >
      <span
        className="mode-marker"
        style={{ transform: `translateY(${marker.top}px)`, height: marker.height }}
        aria-hidden="true"
      />
      {modes.map((item, index) => (
        <button
          key={item.key}
          ref={(el) => {
            itemRefs.current[index] = el;
          }}
          type="button"
          role="menuitemradio"
          aria-checked={item.key === value}
          onClick={() => onPick(item.key)}
          onMouseEnter={() => setActiveIndex(index)}
          className="mode-item"
        >
          <Icon name={item.icon} className={`mt-0.5 size-4 shrink-0 ${item.key === value ? "text-accent" : "text-white/40"}`} />
          <span className="min-w-0 flex-1">
            <span className="mode-item-title flex items-center gap-2">
              {item.label}
              {item.pending && <span className="rounded-full border border-line px-1.5 text-3xs text-text-faint">开发中</span>}
            </span>
            <span className="mode-item-hint mt-0.5 block">{item.hint}</span>
          </span>
          {item.key === value && <Icon name="check" className="mt-0.5 size-3.5 shrink-0 text-accent" />}
        </button>
      ))}
    </div>,
    document.body,
  );
}
