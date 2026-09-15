"use client";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
    public readonly code: string | null = null,
  ) {
    super(message);
  }
}

type ErrorPayload = { error?: unknown; code?: unknown };

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiRequestError(
      response.ok ? "O servidor retornou uma resposta inválida." : `A solicitação falhou (${response.status}).`,
      response.status,
      "INVALID_RESPONSE",
    );
  }
}

export async function apiRequest<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { retries?: number } = {},
): Promise<T> {
  const method = (init.method || "GET").toUpperCase();
  const retries = method === "GET" ? Math.max(0, options.retries ?? 1) : 0;
  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(input, init);
      const payload = await responsePayload(response);
      if (!response.ok) {
        const error = payload && typeof payload === "object" ? payload as ErrorPayload : {};
        throw new ApiRequestError(
          typeof error.error === "string" ? error.error : `A solicitação falhou (${response.status}).`,
          response.status,
          typeof error.code === "string" ? error.code : null,
        );
      }
      return payload as T;
    } catch (error) {
      if (error instanceof ApiRequestError || attempt >= retries) {
        if (error instanceof ApiRequestError) throw error;
        throw new ApiRequestError("Não foi possível conectar ao servidor. Tente novamente.");
      }
      attempt += 1;
    }
  }
}

export function jsonRequest(method: "POST" | "PATCH" | "DELETE", body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
