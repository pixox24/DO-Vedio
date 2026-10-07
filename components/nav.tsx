"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Icon } from "./ui";

/**
 * 顶部导航。
 *
 * 原来 7 项平级铺开：高频的「项目」和低频的「存储」「项目更新」权重相同，
 * 且「解说风格」（文案怎么写）与「画面风格」（画面怎么画）同名不同义，无从区分。
 *
 * 现在分三层：
 *   项目            —— 最高频，独占一项
 *   创作资源 ▾      —— 三个资源库，按「文案侧 / 画面侧」排列
 *   设置 ▾          —— 低频配置与档案
 *
 * 分组用原生 <details>，无额外状态：键盘可达、Esc 关闭、点击外部关闭。
 */

type NavItem = { href: string; label: string; hint: string; exact?: boolean };

/** 创作资源：前两项影响文案，第三项影响画面 */
const resourceItems: NavItem[] = [
  { href: "/templates", label: "解说风格", hint: "稿子怎么写、怎么念" },
  { href: "/memes", label: "梗库", hint: "近期流行梗与网感素材" },
  { href: "/styles", label: "画面风格", hint: "画面怎么画、配色与质感" },
];

const settingItems: NavItem[] = [
  { href: "/settings", label: "设置总览", hint: "模型、存储与项目档案", exact: true },
  { href: "/settings/providers", label: "模型中心", hint: "服务商、模型与 API Key" },
  { href: "/settings/storage", label: "存储", hint: "占用、清理与回收站" },
  { href: "/changelog", label: "项目更新", hint: "按版本记录的演进历史" },
];

const isActive = (path: string, href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(`${href}/`));

export function Nav() {
  const path = usePathname();
  const navRef = useRef<HTMLElement>(null);

  // 点击外部 / 切换路由时收起展开的分组
  useEffect(() => {
    const closeAll = () => navRef.current?.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"));
    const onPointerDown = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) closeAll();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAll();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    navRef.current?.querySelectorAll("details[open]").forEach((d) => d.removeAttribute("open"));
  }, [path]);

  const projectsActive = path === "/" || path.startsWith("/projects");

  return (
    <nav ref={navRef} className="flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1 rounded-full border border-hairline bg-white/[0.02] p-1">
      <Link href="/" className={`nav-pill ${projectsActive ? "nav-pill-active" : ""}`}>
        项目
      </Link>

      <NavGroup label="创作资源" items={resourceItems} path={path} />
      <NavGroup label="设置" items={settingItems} path={path} />
    </nav>
  );
}

function NavGroup({ label, items, path }: { label: string; items: NavItem[]; path: string }) {
  const active = items.some((item) => isActive(path, item.href, item.exact));

  return (
    <details className="group relative">
      <summary
        className={`nav-pill cursor-pointer list-none ${active ? "nav-pill-active" : ""}`}
        aria-label={active ? `${label}（当前所在分组）` : label}
      >
        {label}
        <Icon name="chevron" className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>

      <div className="nav-menu" role="menu">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            role="menuitem"
            className={`flex flex-col gap-0.5 rounded-control px-3 py-2.5 text-left transition hover:bg-white/[0.08] ${
              isActive(path, item.href, item.exact) ? "bg-accent/[0.12]" : ""
            }`}
          >
            <span className="text-sm text-white">{item.label}</span>
            <span className="text-2xs leading-snug text-text-faint">{item.hint}</span>
          </Link>
        ))}
      </div>
    </details>
  );
}
