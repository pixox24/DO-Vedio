"use client";

import Link from "next/link";
import { Alert, Spinner } from "@/components/ui";
import { groupReferenceStatuses, mediaIssue } from "@/lib/core/reference-status";
import type { Shot } from "@/lib/core/types";

export function ReferenceFeedback({ groups, ordered, busy, onShot, onSettings, onStandards, onGenerate }: {
  groups: ReturnType<typeof groupReferenceStatuses>; ordered: Shot[]; busy: boolean;
  onShot: (shotId: string) => void; onSettings: () => void; onStandards: () => void;
  onGenerate: (shots: Shot[], retry: boolean) => void;
}) {
  const failed = groups.filter((group) => group.status.kind === "failed");
  const failedShots = failed.flatMap((group) => group.shots).filter((shot) => !shot.locked);
  const primary = failed.find((group) => group.issue?.settings) ?? failed[0];
  if (!groups.length) return null;
  return <div id="reference-feedback" className="space-y-3">
    {primary && <Alert tone="danger" size="sm" role="status">
      <span className="block font-medium">部分参考图未生成</span>
      <span className="mt-1 block">{primary.issue!.title} · {primary.shots.length} 镜。{primary.issue!.message}</span>
      {failed.length > 1 && <span className="mt-1 block">另有 {failed.filter((group) => group !== primary).reduce((count, group) => count + group.shots.length, 0)} 镜的问题可在下方按模型与原因查看。</span>}
      <span className="mt-3 flex flex-wrap items-center gap-2">
        {primary.issue!.settings && <button type="button" className="btn btn-ghost btn-sm" onClick={onSettings}>检查图片模型</button>}
        {failedShots.length > 0 && <button type="button" className={primary.issue!.settings ? "btn btn-text btn-sm" : "btn btn-ghost btn-sm"} disabled={busy} onClick={() => onGenerate(failedShots, true)}>
          {busy && <Spinner className="size-3" />}重试失败的 {failedShots.length} 张参考图
        </button>}
      </span>
    </Alert>}
    <details className="text-xs text-text-secondary">
      <summary className="cursor-pointer">{groups.reduce((count, group) => count + group.shots.length, 0)} 镜待完成 · 查看原因与受影响镜头</summary>
      <div className="mt-3 space-y-4">
        {groups.map((group) => <div key={group.key} className="space-y-2">
          <p className={group.issue ? "text-danger" : "text-text-secondary"}>{group.issue?.title ?? group.status.label} · {group.shots.length} 镜</p>
          {group.issue && <p className="text-text-muted">{group.issue.message}</p>}
          <div className="flex flex-wrap gap-2">{group.shots.map((shot) => <button type="button" key={shot.id} className="chip pointer-coarse:min-h-11" onClick={() => onShot(shot.id)}>镜头 {String(ordered.indexOf(shot) + 1).padStart(2, "0")}</button>)}</div>
          {group.status.kind === "standard" && <><p className="text-text-muted">补齐并采用关联标准图后，才能生成镜头参考图或继续生成视频。</p><button type="button" className="btn btn-text btn-sm" onClick={onStandards}>查看角色和场景</button></>}
          {["missing", "stale", "canceled"].includes(group.status.kind) && group.shots.some((shot) => !shot.locked) && <button type="button" className="btn btn-text btn-sm" disabled={busy} onClick={() => onGenerate(group.shots.filter((shot) => !shot.locked), false)}>{group.status.kind === "stale" ? "更新" : "生成"}这 {group.shots.filter((shot) => !shot.locked).length} 张参考图</button>}
          {group.issue && <details className="text-text-muted"><summary className="cursor-pointer">技术详情</summary><div className="mt-2 space-y-2">
            <p className="break-all">模型：{group.status.modelId ?? "项目参考图模型"}</p>
            <pre className="whitespace-pre-wrap break-all text-2xs">{group.status.error}</pre>
            <Link className="underline" href="/settings/providers">打开模型中心</Link>
          </div></details>}
        </div>)}
      </div>
    </details>
  </div>;
}

export function GenerationError({ error, video = false }: { error: string; video?: boolean }) {
  const issue = mediaIssue(error);
  return <div role="status" className="space-y-2 text-xs">
    <p className="text-danger">{video ? "视频生成未完成，请恢复原任务核对结果。" : `${issue.title}。${issue.message}`}</p>
    <details className="text-text-muted"><summary className="cursor-pointer">技术详情</summary><pre className="mt-2 whitespace-pre-wrap break-all text-2xs">{error}</pre></details>
  </div>;
}
