import Link from "next/link";
import type { Metadata } from "next";
import { Icon } from "@/components/ui";

export const metadata: Metadata = {
  title: "设置 — DO·Vedio",
  description: "模型中心、存储管理与项目更新记录",
};

/**
 * 设置落地页。
 * 原来「模型中心」「存储」「项目更新」平铺在主导航里，与其他功能同等权重；
 * 现在收进 /settings，这里给一个总览入口，导航分组也有地方落。
 */

const sections = [
  {
    href: "/settings/providers",
    title: "模型中心",
    hint: "配置服务商与模型",
    description: "只有填了 API Key 的模型才会出现在创作页。支持内置服务商，也可以添加任意 OpenAI Compatible 或 Anthropic Messages 接口的第三方服务商。",
    icon: "bolt" as const,
  },
  {
    href: "/settings/storage",
    title: "存储",
    hint: "占用、清理与回收站",
    description: "查看素材库、渲染缓存、临时文件和数据库的占用，一键清理；删除的项目在回收站保留 30 天，可随时恢复或彻底删除。",
    icon: "server" as const,
  },
  {
    href: "/changelog",
    title: "项目更新",
    hint: "按版本记录的演进历史",
    description: "新功能、体验优化、问题修复与架构调整都会按版本留档，想了解项目已有的能力可以先看这里。",
    icon: "clock" as const,
  },
];

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl pt-12">
      <p className="label">设置</p>
      <h1 className="mt-3 text-5xl font-semibold tracking-[-0.03em]">设置与资源</h1>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-text-muted">
        这里放与具体项目无关的配置和档案。项目的音色、画幅、字幕和配乐在各自的制作页里调整。
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="panel group flex flex-col gap-3 p-5 transition hover:border-line-strong"
          >
            <span className="grid size-9 place-items-center rounded-control border border-line bg-white/[0.03] text-accent">
              <Icon name={section.icon} className="size-4" />
            </span>
            <span className="flex items-baseline gap-2">
              <span className="text-base font-medium text-white">{section.title}</span>
              <span className="text-2xs text-text-faint">{section.hint}</span>
            </span>
            <span className="text-sm leading-relaxed text-text-muted">{section.description}</span>
            <span className="mt-auto inline-flex items-center gap-1 pt-2 text-xs text-white/40 transition group-hover:text-white">
              打开 <Icon name="arrow" className="size-3.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
