import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "hyperdriver_session";
const publicPaths = new Set(["/", "/login", "/set-password", "/primeira-senha"]);
const REPLAY_ID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d+)$/i;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    publicPaths.has(pathname) ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.svg" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/profile/avatar-options" ||
    pathname.startsWith("/api/replays")
  ) {
    return NextResponse.next();
  }
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("returnTo", safeRelativePath(canonicalReturnTo(pathname, request.nextUrl.search)));
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

function safeRelativePath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://hyperdriver.local");
    if (url.origin !== "https://hyperdriver.local") return "/";
    if (
      url.pathname === "/login" ||
      url.pathname === "/set-password" ||
      url.pathname === "/primeira-senha"
    ) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function canonicalReturnTo(pathname: string, search: string): string {
  if (pathname === "/me") return `/replays${search}`;

  const tableMatch = pathname.match(/^\/table\/([^/]+)$/);
  if (tableMatch && REPLAY_ID_PATTERN.test(tableMatch[1])) {
    return `/replays/${tableMatch[1]}/table${search}`;
  }

  const telemetryMatch = pathname.match(/^\/telemetry\/([^/]+)$/);
  if (telemetryMatch && REPLAY_ID_PATTERN.test(telemetryMatch[1])) {
    return `/replays/${telemetryMatch[1]}${search}`;
  }

  return `${pathname}${search}`;
}
