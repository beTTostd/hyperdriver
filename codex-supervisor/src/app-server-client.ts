import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type {
  AppServerMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./types.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface AppServerClientOptions {
  command?: string;
  args?: string[];
  requestTimeoutMs?: number;
  onStderr?: (line: string) => void;
  onProtocolError?: (error: Error) => void;
}

type NotificationHandler = (message: JsonRpcNotification) => void | Promise<void>;
type ServerRequestHandler = (message: JsonRpcRequest) => void | Promise<void>;
type ExitHandler = (error: Error) => void;

export class AppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number | string, PendingRequest>();
  private readonly notificationHandlers = new Set<NotificationHandler>();
  private readonly serverRequestHandlers = new Set<ServerRequestHandler>();
  private readonly exitHandlers = new Set<ExitHandler>();
  private closing = false;

  constructor(private readonly options: AppServerClientOptions = {}) {}

  async start(): Promise<void> {
    if (this.process) {
      throw new Error("Codex app-server client is already started.");
    }

    const command =
      this.options.command || process.env.CODEX_SUPERVISOR_CODEX_BIN || "codex";
    const args = this.options.args || ["app-server"];
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.process = child;

    child.once("error", (error) => this.handleExit(error));
    child.once("exit", (code, signal) => {
      if (!this.closing) {
        this.handleExit(
          new Error(
            `Codex app-server exited unexpectedly (code=${String(code)}, signal=${String(signal)}).`,
          ),
        );
      }
    });

    const output = createInterface({ input: child.stdout });
    output.on("line", (line) => this.handleLine(line));
    const errors = createInterface({ input: child.stderr });
    errors.on("line", (line) => this.options.onStderr?.(line));

    await this.request("initialize", {
      clientInfo: {
        name: "hyperdriver_codex_supervisor",
        title: "Hyperdriver Codex Supervisor",
        version: "0.1.0",
      },
    });
    this.notify("initialized", {});
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onServerRequest(handler: ServerRequestHandler): () => void {
    this.serverRequestHandlers.add(handler);
    return () => this.serverRequestHandlers.delete(handler);
  }

  onExit(handler: ExitHandler): () => void {
    this.exitHandlers.add(handler);
    return () => this.exitHandlers.delete(handler);
  }

  request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const id = this.nextRequestId++;
    const timeoutMs = this.options.requestTimeoutMs ?? 30_000;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      timer.unref();

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      try {
        this.send({ id, method, ...(params ? { params } : {}) });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.send({ method, ...(params ? { params } : {}) });
  }

  respond(id: number | string, result: unknown): void {
    this.send({ id, result });
  }

  respondError(id: number | string, message: string, code = -32_000): void {
    this.send({ id, error: { code, message } });
  }

  async close(): Promise<void> {
    this.closing = true;
    const child = this.process;
    this.process = null;
    if (!child || child.exitCode !== null) {
      return;
    }

    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
        resolve();
      }, 2_000);
      timer.unref();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private send(message: AppServerMessage): void {
    if (!this.process || !this.process.stdin.writable) {
      throw new Error("Codex app-server is not connected.");
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: AppServerMessage;
    try {
      message = JSON.parse(line) as AppServerMessage;
    } catch {
      this.options.onProtocolError?.(
        new Error(`Invalid JSON from Codex app-server: ${line.slice(0, 500)}`),
      );
      return;
    }

    if ("id" in message && !("method" in message)) {
      this.handleResponse(message as JsonRpcResponse);
      return;
    }

    if ("method" in message && "id" in message) {
      for (const handler of this.serverRequestHandlers) {
        void Promise.resolve(handler(message as JsonRpcRequest)).catch((error) => {
          this.options.onProtocolError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        });
      }
      return;
    }

    if ("method" in message) {
      for (const handler of this.notificationHandlers) {
        void Promise.resolve(handler(message as JsonRpcNotification)).catch((error) => {
          this.options.onProtocolError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        });
      }
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (response.error) {
      const error = new Error(
        response.error.message || "Unknown Codex app-server error.",
      ) as Error & { code?: number; data?: unknown };
      error.code = response.error.code;
      error.data = response.error.data;
      pending.reject(error);
    } else {
      pending.resolve(response.result);
    }
  }

  private handleExit(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.process = null;
    for (const handler of this.exitHandlers) {
      handler(error);
    }
  }
}
