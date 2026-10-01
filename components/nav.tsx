"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "项目" },
  { href: "/templates", label: "解说风格" },
  { href: "/memes", label: "梗库" },
  { href: "/styles", label: "画面风格" },
  { href: "/settings/providers", label: "模型中心" },
  { href: "/settings/storage", label: "存储" },
  { href: "/changelog", label: "项目更新" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex min-w-0 max-w-full flex-wrap items-center justify-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.02] p-1">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded-full px-3 py-1.5 text-sm transition sm:px-4 ${
            (l.href === "/" ? path === "/" || path.startsWith("/projects") : path.startsWith(l.href)) ? "bg-white text-black" : "text-white/55 hover:text-white"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
