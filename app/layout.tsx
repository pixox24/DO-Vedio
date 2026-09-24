import type { Metadata } from "next";
import Link from "next/link";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "DO·Vedio — AI 视频文案工坊",
  description: "输入标题与概要，一键生成带时间轴的视频解说文案",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink/70 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grid size-7 place-items-center rounded-lg bg-accent text-[13px] font-black text-black">D</span>
              <span className="text-[15px] font-semibold tracking-tight">
                DO<span className="text-accent">·</span>Vedio
              </span>
            </Link>
            <Nav />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-6 pb-24">{children}</main>
      </body>
    </html>
  );
}
