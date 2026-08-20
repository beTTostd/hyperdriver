import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "hyperdriver_session";
const publicPaths = new Set(["/", "/login", "/primeira-senha"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    publicPaths.has(pathname) ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.svg" ||
    pathname.startsWith("/api/auth/")
  ) {
    return NextResponse.next();
  }
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("returnTo", safeRelativePath(`${pathname}${request.nextUrl.search}`));
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
    if (url.pathname === "/login" || url.pathname === "/primeira-senha") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
