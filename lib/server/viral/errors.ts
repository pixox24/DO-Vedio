import type { z } from "zod";
import type { ViralApiError, ViralApiErrorCode, ViralApiResponse } from "../../viral/types";

export class ViralError extends Error {
  constructor(readonly code: ViralApiErrorCode, message: string, readonly status = 400, readonly details: Pick<ViralApiError, "fields" | "currentRevision"> = {}) {
    super(message);
    this.name = "ViralError";
  }
}

export function viralSuccess<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data } satisfies ViralApiResponse<T>, { status, headers: { "Cache-Control": "no-store" } });
}

export async function viralBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "form"] ??= issue.message;
    throw new ViralError("validation", parsed.error.issues[0]?.message ?? "请检查输入", 400, { fields });
  }
  return parsed.data;
}

export async function viralHandle(fn: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    const known = error instanceof ViralError;
    if (!known) console.error("[viral]", error);
    const failure: ViralApiResponse<never> = { ok: false, error: {
      code: known ? error.code : "save_failed",
      message: known ? error.message : "保存未完成，当前输入仍可重试",
      ...(known ? error.details : {}),
    } };
    return Response.json(failure, { status: known ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
