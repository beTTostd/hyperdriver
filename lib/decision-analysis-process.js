import { fork } from "node:child_process";
import { resolve } from "node:path";

/** @param {{ signal?: AbortSignal, timeoutMs?: number }} execution */
export function analyzeInSeparateProcess(document, options = {}, execution = {}) {
  const { signal, timeoutMs = 120000 } = execution;
  return new Promise((resolveResult, reject) => {
    if (signal?.aborted) { reject(new Error("Analysis lease lost")); return; }
    const child = fork(resolve(process.cwd(), "lib/decision-analysis-process.mjs"), [], {
      execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"], serialization: "advanced",
    });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      child.kill();
      if (error) reject(error); else resolveResult(result);
    };
    const abort = () => finish(new Error("Analysis lease lost"));
    const timer = setTimeout(() => finish(new Error("Analysis process timed out")), timeoutMs);
    timer.unref();
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", () => finish(new Error("Analysis process unavailable")));
    child.once("exit", () => finish(new Error("Analysis process exited without a result")));
    child.once("message", (message) => {
      if (message?.ok && message.result?.versions && Array.isArray(message.result.analyses)) finish(null, message.result);
      else finish(new Error("Analysis process failed"));
    });
    child.send({ document, options }, (error) => { if (error) finish(new Error("Analysis process IPC failed")); });
  });
}
