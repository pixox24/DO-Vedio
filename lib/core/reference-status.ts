import type { GenerationFrame } from "./output-spec";
import type { Job, ProjectDoc, Shot } from "./types";
import { missingVideoStandards, sourceImageSnapshot, sourceImageStale } from "./video";
import { videoPlanNeedsSync } from "./video-plan";

export function mediaIssue(raw: string | null | undefined) {
  let detail = raw?.trim() || "生成请求未完成";
  try {
    const body = JSON.parse(detail);
    const message = body?.detail ?? body?.error?.message ?? body?.message ?? body?.error;
    if (typeof message === "string") detail = message;
  } catch { /* Non-JSON provider errors are also retained in technical details. */ }
  if (/model.*(not[ _]found|not[ _]exist|unavailable)|unknown model|模型.*(不可用|不存在|未配置|已变化|无可用渠道)|没有可用.*模型|可用的.*模型/i.test(detail)) {
    return { code: "model", title: "图片模型不可用", message: "请检查所选模型、服务商接口配置和账号权限，再继续生成。", settings: true };
  }
  if (/401|403|unauthori[sz]ed|forbidden|api.?key|authentication|鉴权|权限|密钥/i.test(detail)) {
    return { code: "auth", title: "服务商鉴权或权限异常", message: "请检查服务商密钥和模型访问权限。", settings: true };
  }
  if (/insufficient|balance|credit|余额|欠费|额度不足/i.test(detail)) {
    return { code: "balance", title: "服务商额度不足", message: "请检查服务商账户额度，处理后再继续生成。", settings: true };
  }
  if (/429|rate.?limit|too many requests|限流|请求过于频繁/i.test(detail)) {
    return { code: "rate", title: "服务商请求受限", message: "请稍后重试失败的参考图。", settings: false };
  }
  if (/timeout|timed out|超时|fetch failed|ECONN|ENOTFOUND|network|网络/i.test(detail)) {
    return { code: "network", title: "生成请求超时或连接失败", message: "可以稍后重试失败的参考图。", settings: false };
  }
  if (/\b50[0234]\b|service unavailable|internal server error|服务暂时不可用/i.test(detail)) {
    return { code: "service", title: "服务商暂时不可用", message: "请稍后重试失败的参考图。", settings: false };
  }
  return { code: `other:${detail}`, title: "参考图生成失败", message: "请查看技术详情，确认原因后重试。", settings: false };
}

export type ReferenceStatus = {
  kind: "plan" | "queued" | "running" | "standard" | "failed" | "canceled" | "missing" | "stale" | "ready";
  label: string;
  usable: boolean;
  standardState?: "active" | "failed" | "canceled" | "missing";
  error?: string;
  modelId?: string;
};

type StatusJob = Pick<Job, "stage" | "status" | "input" | "key" | "error" | "createdAt">;

/** Current image inputs decide readiness; historical jobs and video errors cannot override it. */
export function shotReferenceStatus(doc: ProjectDoc, shot: Shot, frame: GenerationFrame, jobs: readonly StatusJob[]): ReferenceStatus {
  if (videoPlanNeedsSync(shot)) return { kind: "plan", label: "镜头要求待同步", usable: false };
  const missing = missingVideoStandards(doc, shot);
  if (missing.length) {
    const latest = missing.map((dependency) => jobs.filter((job) => {
      const input = job.input as { sceneId?: string; characterId?: string; kind?: string } | null;
      return dependency.kind === "scene" ? job.stage === "scene-reference" && input?.sceneId === dependency.id
        : job.stage === "character-sheet" && input?.kind === "portrait" && input.characterId === dependency.id;
    }).sort((a, b) => b.createdAt - a.createdAt)[0]);
    const failed = latest.some((job) => job?.status === "failed");
    const active = latest.some((job) => job?.status === "queued" || job?.status === "running");
    const canceled = latest.some((job) => job?.status === "canceled");
    const standardState = active ? "active" : failed ? "failed" : canceled ? "canceled" : "missing";
    const label = active ? "等待角色和场景标准图" : failed ? "前置标准图需处理" : canceled && doc.settings.autoPortrait ? "标准图已停止，待继续制作" : "待补齐角色和场景标准图";
    return { kind: "standard", standardState, label, usable: false };
  }
  const references = jobs.filter((job) => job.stage === "shot-reference" && (job.input as { shotId?: string } | null)?.shotId === shot.id).sort((a, b) => b.createdAt - a.createdAt);
  const active = references.find((job) => job.status === "queued" || job.status === "running");
  if (active) return { kind: active.status as "queued" | "running", label: active.status === "queued" ? "参考图等待生成" : "参考图生成中", usable: false };
  const stale = sourceImageStale(doc, shot, frame);
  if (shot.sourceImageAssetId && !stale) return { kind: "ready", label: "参考图已就绪", usable: true };
  const key = `shot-reference:${shot.id}:${sourceImageSnapshot(doc, shot, frame).promptHash}`;
  const latest = references.find((job) => job.key === key);
  if (latest?.status === "failed") return { kind: "failed", label: "参考图生成失败", usable: false, error: latest.error ?? "生成请求未完成", modelId: (latest.input as { modelId?: string } | null)?.modelId };
  if (latest?.status === "canceled") return { kind: "canceled", label: "参考图生成已停止", usable: false };
  return { kind: stale ? "stale" : "missing", label: stale ? "参考图需要更新" : "参考图尚未生成", usable: false };
}

export function groupReferenceStatuses(items: { shot: Shot; status: ReferenceStatus }[]) {
  const groups = new Map<string, { key: string; status: ReferenceStatus; shots: Shot[]; issue?: ReturnType<typeof mediaIssue> }>();
  for (const { shot, status } of items) {
    if (status.usable) continue;
    const issue = status.kind === "failed" ? mediaIssue(status.error) : undefined;
    const key = [status.kind, status.modelId ?? "", issue?.code ?? "", status.kind === "standard" ? status.label : ""].join(":");
    const group = groups.get(key);
    if (group) group.shots.push(shot);
    else groups.set(key, { key, status, shots: [shot], issue });
  }
  return [...groups.values()];
}
