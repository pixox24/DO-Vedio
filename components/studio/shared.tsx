"use client";

// 共享类型与工具：被句子/镜头/配乐/设置四个面板复用。

/* 本文件由 components/video-controls.tsx 拆分而来（见 docs/redesign-diagnosis-and-plan.md 第 3 阶段）。 */
import type { Job, ProjectDoc } from "@/lib/core/types";
import type { SaveState } from "@/lib/client";
import { costLabel } from "@/lib/core/interaction";

export type ProjectStore = {
  doc: ProjectDoc | null;
  setDoc: (fn: (doc: ProjectDoc) => ProjectDoc) => void;
  save: SaveState;
  flush: () => Promise<unknown>;
  reload: () => Promise<void>;
};

export type LineInfo = {
  id: string;
  spoken: string;
  /** 这一句当前的配音缓存键；撤销重录时用它定位归档记录 */
  ttsKey: string;
  /** 重录这句的预估费用（元）；段落模式下按块计费，见 blockCostYuan */
  costYuan?: number;
  /** 段落模式：重录本段的预估费用（整块重算） */
  blockCostYuan?: number | null;
  audio: { src: string; startMs: number; endMs: number; aligned: boolean; alignmentSource?: "provider" | "forced" | "estimated" } | null;
  capabilities?: string[];
  job: { id: string; status: string; error: string | null } | null;
  /** 段落配音：同一块的句子一起合成、一起重录 */
  block: { key: string; index: number; count: number; confidence: number | null; blockSrc: string | null; outcome: "block" | "halved" | "line" | null; splitSource: "provider" | "vad" | null; subKey: string | null } | null;
};

export type ImageJobInput = { batchId?: string };

/** 把预估费用拼进句子文案；无法估算时返回空串 */
export function costLabelText(costYuan: number | null | undefined) {
  const label = costLabel(typeof costYuan === "number" ? costYuan : null);
  return label ? `，${label}` : "";
}

/** 任务所属的批次 id（配音与生图共用同一约定：写在 input.batchId） */
export function jobBatchId(job: Job) {
  if (!job.input || typeof job.input !== "object") return undefined;
  const value = (job.input as ImageJobInput).batchId;
  return typeof value === "string" ? value : undefined;
}
