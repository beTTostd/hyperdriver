import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { NextResponse } from "next/server";

type RequestLogContext = {
  requestId: string;
  route: string;
  userId: number | null;
};

const requestContext = new AsyncLocalStorage<RequestLogContext>();

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimitIdentity(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function validateMutationOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";

  try {
    const configured = process.env.APP_URL?.trim();
    const expected = configured ? new URL(configured).origin : new URL(request.url).origin;
    return new URL(origin).origin === expected;
  } catch {
    return false;
  }
}

export function originError(): NextResponse {
  return privateJson({ error: "Origem da requisição não permitida." }, { status: 403 });
}

export function privateJson(
  body: unknown,
  init: ResponseInit = {},
): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  response.headers.set("pragma", "no-cache");
  return response;
}

export function rateLimitedResponse(retryAfter: number, message = "Muitas tentativas. Tente novamente mais tarde.") {
  const response = privateJson({ error: message }, { status: 429 });
  response.headers.set("retry-after", String(Math.max(1, Math.ceil(retryAfter))));
  return response;
}

export function annotateRequestUser(userId: number): void {
  const context = requestContext.getStore();
  if (context) context.userId = userId;
}

export function withApiLogging<TArgs extends unknown[]>(
  route: string,
  handler: (request: Request, ...args: TArgs) => Promise<Response>,
) {
  return async (request: Request, ...args: TArgs): Promise<Response> => {
    const startedAt = performance.now();
    const requestId = request.headers.get("x-request-id")?.slice(0, 128) || randomUUID();
    const context: RequestLogContext = { requestId, route, userId: null };

    return requestContext.run(context, async () => {
      let status = 500;
      try {
        const response = await handler(request, ...args);
        status = response.status;
        response.headers.set("x-request-id", requestId);
        return response;
      } finally {
        console.log(JSON.stringify({
          level: status >= 500 ? "error" : "info",
          type: "http_request",
          requestId,
          method: request.method,
          route,
          status,
          durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
          userId: context.userId,
        }));
      }
    });
  };
}

export async function readRequestBody(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw Object.assign(new Error("body_too_large"), { code: "BODY_TOO_LARGE" });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
