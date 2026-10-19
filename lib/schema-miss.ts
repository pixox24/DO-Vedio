import { NoObjectGeneratedError } from "ai";

/**
 * 把「结构化输出不匹配」压成一行可读的归因。
 *
 * 单独成文件而不是挂在 `lib/llm.ts` 上：多个 stage 都要在报错与任务记录里用它，
 * 而测试里普遍把 `@/lib/llm` 整个 mock 掉——放在那里会让每个 mock 都得跟着补导出。
 *
 * 输出形如 `shots.1.stockQuery: 检索词必须是小写英文，2–4 个词 | shots.3.videoPlan: ...`，
 * 优先取 Zod 的字段路径，拿不到就退到内层错误消息。
 */
export function schemaMissSummary(error: unknown): string | undefined {
  if (!NoObjectGeneratedError.isInstance(error)) return undefined;
  const issues = (error.cause as { issues?: { path: (string | number)[]; message: string }[] })?.issues;
  if (Array.isArray(issues) && issues.length) {
    return issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join(" | ");
  }
  return error.cause instanceof Error ? error.cause.message : undefined;
}
