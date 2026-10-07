import type { Metadata } from "next";
import Link from "next/link";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import { FeedbackProvider } from "@/components/feedback";
import "./globals.css";

/**
 * 字体原来只在 globals.css 的 --font-sans 里写了个名字，
 * 从没真正加载过——除非用户本机装了 Inter，否则实际渲染的是系统字体。
 * 这里用 next/font 自托管（构建期下载，浏览器不请求 Google）。
 * 变量名与 app/globals.css 的 --font-sans / --font-mono 对应。
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "DO·Vedio — AI 视频文案工坊",
  description: "输入标题与概要，一键生成带时间轴的视频解说文案",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className={`h-full antialiased ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="flex min-h-full flex-col overflow-x-hidden">
        <FeedbackProvider>
        <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink/70 backdrop-blur-xl">
          <div className="mx-auto flex min-h-16 max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grid size-7 place-items-center rounded-lg bg-accent text-[13px] font-black text-black">D</span>
              <span className="text-[15px] font-semibold tracking-tight">
                DO<span className="text-accent">·</span>Vedio
              </span>
            </Link>
            <Nav />
          </div>
        </header>
        <main className="mx-auto min-w-0 w-full max-w-[1440px] flex-1 px-4 pb-24 sm:px-6">{children}</main>
        </FeedbackProvider>
      </body>
    </html>
  );
}
