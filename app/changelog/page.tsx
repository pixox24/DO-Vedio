"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui";
import { changeKindMeta, changeKindOrder, changelog, type ChangeEntry, type ChangeKind } from "@/lib/changelog";

/**
 * 项目更新页：按版本倒序展示重大更新，左侧为版本索引与分类图例。
 * 数据来自 lib/changelog.ts。
 */
export default function ChangelogPage() {
  const [active, setActive] = useState(changelog[0]?.version ?? "");
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const latest = changelog[0];

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const version = visible[0]?.target.getAttribute("data-version");
        if (version) setActive(version);
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: 0 },
    );
    Object.values(refs.current).forEach((element) => element && observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const jump = (version: string) => refs.current[version]?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="pt-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="label">项目档案</p>
          <h1 className="mt-3 text-5xl font-semibold tracking-[-0.03em]">项目更新</h1>
          <p className="mt-3 max-w-xl text-sm text-white/45">记录 DO·Vedio 的每一次重大进化。新功能、体验优化、问题修复与架构调整都会按版本留在这里。</p>
        </div>
        {latest && (
          <div className="panel hidden px-5 py-3.5 text-right sm:block">
            <p className="label">最新版本</p>
            <p className="mt-1 font-mono text-xl font-semibold text-accent">v{latest.version}</p>
            <p className="text-xs text-white/40">{latest.date} · 共 {changelog.length} 个版本</p>
          </div>
        )}
      </div>

      <nav className="mt-6 flex gap-2 overflow-x-auto lg:hidden" aria-label="版本索引">
        {changelog.map((entry) => (
          <button key={entry.version} className={`chip ${active === entry.version ? "chip-on" : ""}`} onClick={() => jump(entry.version)}>
            v{entry.version}
          </button>
        ))}
      </nav>

      <div className="mt-10 grid gap-10 lg:grid-cols-[240px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-8">
            <div>
              <p className="label">版本索引</p>
              <ol className="mt-4 space-y-0.5 border-l border-white/[0.08]">
                {changelog.map((entry) => (
                  <li key={entry.version}>
                    <button
                      onClick={() => jump(entry.version)}
                      className={`-ml-px flex w-full flex-col gap-1 border-l-2 py-2.5 pr-2 pl-4 text-left transition ${
                        active === entry.version ? "border-accent text-white" : "border-transparent text-white/40 hover:border-white/20 hover:text-white/80"
                      }`}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="font-mono text-xs font-medium">{entry.version}</span>
                        <span className="font-mono text-[11px] text-white/30">{entry.date}</span>
                      </span>
                      <span className="line-clamp-2 text-xs leading-5">{entry.title}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="label">分类</p>
              <ul className="mt-4 space-y-2.5">
                {changeKindOrder.map((kind) => (
                  <li key={kind} className="flex items-center gap-2 text-xs text-white/50">
                    <span className={`size-1.5 rounded-full ${changeKindMeta[kind].dot}`} />
                    {changeKindMeta[kind].label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-8">
          {changelog.map((entry) => (
            <Entry
              key={entry.version}
              entry={entry}
              active={active === entry.version}
              ref={(element) => {
                refs.current[entry.version] = element;
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Entry({ entry, active, ref }: { entry: ChangeEntry; active: boolean; ref: (element: HTMLElement | null) => void }) {
  const grouped = changeKindOrder
    .map((kind) => ({ kind, items: entry.items.filter((item) => item.kind === kind) }))
    .filter((group) => group.items.length > 0);

  return (
    <section ref={ref} data-version={entry.version} className="scroll-mt-24">
      <article className={`panel overflow-hidden transition ${active ? "border-accent/25" : ""}`}>
        <header className="border-b border-white/[0.06] p-6 sm:p-7">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="rounded-full bg-accent px-3 py-1 font-mono text-xs font-semibold text-black">v{entry.version}</span>
            <h2 className="text-xl font-semibold tracking-tight">{entry.title}</h2>
            <time className="ml-auto font-mono text-xs text-white/35">{entry.date}</time>
          </div>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/55">{entry.summary}</p>
        </header>
        <div className="divide-y divide-white/[0.05]">
          {grouped.map(({ kind, items }) => (
            <Group key={kind} kind={kind} count={items.length} items={items} />
          ))}
        </div>
      </article>
    </section>
  );
}

function Group({ kind, count, items }: { kind: ChangeKind; count: number; items: { title: string; detail?: string }[] }) {
  const meta = changeKindMeta[kind];
  return (
    <div className="p-6 sm:p-7">
      <div className="flex items-center gap-2.5">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${meta.badge}`}>
          <Icon name={meta.icon} className="size-3" />
          {meta.label}
        </span>
        <span className="font-mono text-[11px] text-white/25">{count}</span>
      </div>
      <ul className="mt-5 space-y-4">
        {items.map((item) => (
          <li key={item.title} className="grid gap-1.5 sm:grid-cols-[200px_1fr] sm:gap-6">
            <p className="flex items-start gap-2 text-sm leading-6 font-medium text-white/85">
              <span className={`mt-2 size-1.5 shrink-0 rounded-full ${meta.dot}`} />
              {item.title}
            </p>
            {item.detail && <p className="text-sm leading-6 text-white/45">{item.detail}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
