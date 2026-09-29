import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  accessControlEnabled,
  accessTokensMatch,
  productionAccessControlMisconfigured,
} from "@/lib/auth";

const isLoginPath = (pathname: string) => pathname === "/login" || pathname.startsWith("/login/");
const isAuthApiPath = (pathname: string) => pathname === "/api/auth/login" || pathname === "/api/auth/logout";

export function proxy(request: NextRequest) {
  // A local checkout without a token remains usable. Production fails closed below.
  if (!accessControlEnabled()) {
    if (productionAccessControlMisconfigured()) {
      return new NextResponse("DO_VEDIO_ACCESS_TOKEN 未配置，生产服务已停止接受请求。", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  if (isLoginPath(pathname) || isAuthApiPath(pathname)) return NextResponse.next();

  const cookie = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (cookie && accessTokensMatch(cookie)) return NextResponse.next();

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "未授权", code: "AUTH_REQUIRED" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // Keep framework assets and public metadata available before login.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
