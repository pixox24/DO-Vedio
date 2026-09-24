"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "创作" },
  { href: "/templates", label: "风格模板" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1 rounded-full border border-white/[0.07] bg-white/[0.02] p-1">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded-full px-4 py-1.5 text-sm transition ${
            path === l.href ? "bg-white text-black" : "text-white/55 hover:text-white"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
