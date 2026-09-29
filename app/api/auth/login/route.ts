import { NextResponse } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  ACCESS_TOKEN_MAX_AGE,
  accessControlEnabled,
  accessTokensMatch,
} from "@/lib/auth";

export async function POST(request: Request) {
  if (!accessControlEnabled()) return Response.json({ ok: true, enabled: false });

  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token || !accessTokensMatch(token)) {
    return Response.json({ ok: false, error: "访问令牌错误" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const secure = forwardedProto === "https" || new URL(request.url).protocol === "https:";
  response.cookies.set({
    name: ACCESS_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });
  return response;
}
