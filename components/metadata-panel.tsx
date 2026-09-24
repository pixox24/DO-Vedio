"use client";

import { useState } from "react";
import { copy } from "@/lib/client";
import type { Metadata } from "@/lib/types";
import { Icon, Spinner } from "./ui";

type Props = {
  metadata: Metadata | null;
  chapters: string;
  busy: boolean;
  disabled: boolean;
  onGenerate: () => void;
};

export function MetadataPanel({ metadata, chapters, busy, disabled, onGenerate }: Props) {
  const description = metadata ? `${metadata.description}\n\n${chapters}` : "";

  return (
    <section className="panel space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="label">发布素材</p>
          <h3 className="mt-1.5 text-lg font-semibold tracking-tight">标题 · 简介 · 标签</h3>
        </div>
        <button className={`btn btn-sm ${metadata ? "btn-ghost" : "btn-primary"}`} disabled={disabled || busy} onClick={onGenerate}>
          {busy ? <Spinner className="size-3.5" /> : <Icon name="sparkle" className="size-3.5" />}
          {metadata ? "重新生成" : "生成"}
        </button>
      </div>

      {!metadata ? (
        <p className="text-sm leading-relaxed text-white/35">文案完成后，一键生成 3 个备选标题、带章节时间戳的简介和 10 个标签，可直接粘贴到 B站投稿页。</p>
      ) : (
        <div className="animate-rise space-y-5">
          <div className="space-y-2">
            {metadata.titles.map((t, i) => (
              <CopyRow key={i} text={t}>
                <span className="mr-3 font-mono text-xs text-white/25">0{i + 1}</span>
                {t}
              </CopyRow>
            ))}
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label">简介</span>
              <CopyButton text={description} />
            </div>
            <p className="rounded-xl border border-white/[0.06] bg-black/20 p-4 text-sm leading-relaxed whitespace-pre-wrap text-white/75">{description}</p>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="label">标签</span>
              <CopyButton text={metadata.tags.join(",")} />
            </div>
            <div className="flex flex-wrap gap-2">
              {metadata.tags.map((t) => (
                <span key={t} className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/65">
                  #{t}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function CopyRow({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="group flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3 text-sm">
      <span>{children}</span>
      <CopyButton text={text} />
    </div>
  );
}

export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-white/40 transition hover:text-accent"
      onClick={() =>
        copy(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      <Icon name={done ? "check" : "copy"} className="size-3.5" />
      {label && (done ? "已复制" : label)}
    </button>
  );
}
