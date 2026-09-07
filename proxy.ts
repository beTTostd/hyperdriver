import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "hyperdriver_session";
const publicPaths = new Set([
  "/",
  "/login",
  "/politica-de-privacidade",
  "/set-password",
  "/primeira-senha",
]);
const REPLAY_ID_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|\d+)$/i;

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = btoa(crypto.randomUUID());
  const requestId = request.headers.get("x-request-id")?.slice(0, 128) || crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("content-security-policy", contentSecurityPolicy);

  const isPublic =
    publicPaths.has(pathname) ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.svg" ||
    pathname.startsWith("/api/health/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/admin/json" ||
    pathname.startsWith("/api/admin/json/") ||
    pathname.startsWith("/api/coach/") ||
    pathname.startsWith("/coach/") ||
    pathname === "/api/profile/avatar-options" ||
    pathname.startsWith("/api/replays");
  const authenticated = request.cookies.has(SESSION_COOKIE);
  let response: NextResponse;
  if (isPublic || authenticated) {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  } else {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", safeRelativePath(canonicalReturnTo(pathname, request.nextUrl.search)));
    response = NextResponse.redirect(loginUrl);
  }

  response.headers.set("content-security-policy", contentSecurityPolicy);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.headers.set(
    "referrer-policy",
    pathname === "/set-password" || pathname === "/primeira-senha" || pathname.startsWith("/coach/") || pathname.startsWith("/api/coach/") ? "no-referrer" : "strict-origin-when-cross-origin",
  );
  response.headers.set("x-request-id", requestId);
  if (process.env.NODE_ENV === "production") {
    response.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  if (authenticated || pathname.startsWith("/api/")) {
    response.headers.set("cache-control", "private, no-store, max-age=0");
  }
  if (pathname.startsWith("/coach/") || pathname.startsWith("/api/coach/")) {
    response.headers.set("cache-control", "private, no-store, max-age=0");
    response.headers.set("x-robots-tag", "noindex, nofollow");
  }
  return response;
}

export const config = {
  // Large uploads validate authentication, origin and size inside their route.
  // Keeping the exact POST endpoints outside Proxy avoids Next.js truncating
  // their cloned request bodies at its 10 MB proxy buffer limit.
  matcher: ["/((?!_next/static|_next/image|api/replays$|api/admin/json$).*)"],
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
  if (pathname === "/mesa") return `/table${search}`;
  if (pathname === "/admin/partidas") return `/admin/replays${search}`;
  if (pathname === "/perfil/editar") return `/me/profile${search}`;

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

function buildContentSecurityPolicy(nonce: string): string {
  const development = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://images.talishar.net",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    development ? "" : "upgrade-insecure-requests",
  ].filter(Boolean).join("; ");
}
