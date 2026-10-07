"use client";

import { Icon, Spinner } from "@/components/ui";

/**
 * 制作页顶栏常驻状态区。
 *
 * 这些状态原来散落在各处：配音切换进度只在「设置」标签页里轮询（用户切走就看不见）、
 * 成片是否过期只在成片列表的徽章里、Worker 离线只在页面顶部。用户不该为了
 * 「现在到底什么情况」而翻遍页面。每条都可点击跳到对应面板。
 */

export type StudioStatus = {
  /** 配音切换：新配音就绪进度（旧音频仍生效） */
  voice?: { ready: number; total: number; failed: number; onOpen: () => void } | null;
  /** 各画幅成片是否已过期；只显示当前已计算过状态的画幅 */
  renderStale?: Partial<Record<"16:9" | "9:16", boolean>>;
  /** 已花费 */
  spend: number;
  /** 生成服务是否在线 */
  online: boolean | null;
};

export function StudioStatusBar({ voice, renderStale, spend, online }: StudioStatus) {
  const items: { key: string; tone: "accent" | "warn" | "muted"; text: string; onClick?: () => void }[] = [];

  if (voice && voice.total > 0) {
    items.push({
      key: "voice",
      tone: "accent",
      text: `新配音 ${voice.ready}/${voice.total} 就绪${voice.failed ? ` · ${voice.failed} 句失败` : ""} · 当前播旧配音`,
      onClick: voice.onOpen,
    });
  }
  const renderAspects = renderStale ? (["16:9", "9:16"] as const).filter((aspect) => typeof renderStale[aspect] === "boolean") : [];
  if (renderAspects.length) {
    const staleAspects = renderAspects.filter((aspect) => renderStale?.[aspect]);
    const freshAspects = renderAspects.filter((aspect) => !renderStale?.[aspect]);
    items.push({
      key: "render",
      tone: staleAspects.length ? "warn" : "accent",
      text: [...freshAspects.map((aspect) => `${aspect} 最新`), ...staleAspects.map((aspect) => `${aspect} 需重渲染`)].join(" · "),
    });
  }
  items.push({ key: "spend", tone: "muted", text: `已花费 ¥${spend.toFixed(2)}` });
  if (online === false) {
    items.push({ key: "worker", tone: "warn", text: "生成服务未运行" });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs" aria-label="制作状态">
      {items.map((item) => {
        const tone = item.tone === "accent" ? "text-accent" : item.tone === "warn" ? "text-amber-200/85" : "text-white/45";
        const body = (
          <>
            {item.key === "voice" && <Spinner className="size-3" />}
            <span>{item.text}</span>
          </>
        );
        return item.onClick
          ? <button key={item.key} className={`inline-flex items-center gap-1.5 hover:underline ${tone}`} onClick={item.onClick}>{body}</button>
          : <span key={item.key} className={`inline-flex items-center gap-1.5 ${tone}`}>{body}</span>;
      })}
      {online === false && <Icon name="stop" className="size-3 text-amber-200/70" />}
    </div>
  );
}
