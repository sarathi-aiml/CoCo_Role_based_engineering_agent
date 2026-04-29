import { spawn } from "child_process";

const CORTEX_BIN = "cortex";

/** Thrown when the in-flight cortex child is killed (user cancelled or remote Ctrl+C). */
export class CortexCancelledError extends Error {
  /** @param {null|{ remote?: boolean, from?: string }} [ctx] */
  constructor(ctx) {
    super("CANCELLED");
    this.name = "CortexCancelledError";
    this.remote = !!(ctx && ctx.remote);
    this.remoteFrom = ctx && ctx.from != null ? String(ctx.from) : null;
  }
}

export function isCortexCancelledError(err) {
  return err instanceof CortexCancelledError;
}

let activeChild = null;
/** Set before kill; read on SIGTERM so we can mark remote (other terminal) cancels. */
let pendingCancelCtx = null;

/**
 * @param {null|{ remote?: boolean, from?: string }} [ctx] - e.g. `{ remote: true, from: "alex" }` when the other session pressed Ctrl+C
 * @returns {boolean} true if a process was signalled
 */
export function cancelActiveCortex(ctx = null) {
  if (!activeChild) return false;
  pendingCancelCtx = ctx;
  try {
    activeChild.kill("SIGTERM");
  } catch {
    pendingCancelCtx = null;
    /* ignore */
  }
  return true;
}

function buildPrompt(systemPrompt, history) {
  const historyText = history
    .map((h) => (h.role === "user" ? "User: " : "Assistant: ") + h.content)
    .join("\n");
  return systemPrompt + "\n\n---\n\n" + historyText + "\nAssistant:";
}

/**
 * Call cortex and return the full response text.
 * Simple pipe — no PTY, no streaming artefacts.
 * Use `cancelActiveCortex()` to stop the in-flight run (e.g. Ctrl+C, Esc).
 */
export function askCortex(systemPrompt, history) {
  return new Promise((resolve, reject) => {
    const args  = ["--dangerously-allow-all-tool-calls", "-p", buildPrompt(systemPrompt, history)];
    const shell = process.platform === "win32";
    let   child;
    try   { child = spawn(CORTEX_BIN, args, { stdio: ["ignore", "pipe", "pipe"], shell, detached: true }); }
    catch (err) { return reject(err.code === "ENOENT" ? notFoundError() : err); }

    const release = () => {
      if (activeChild === child) activeChild = null;
    };
    activeChild = child;

    let out = "", err = "";
    child.stdout.on("data", (c) => { out += c.toString(); });
    child.stderr.on("data", (c) => { err += c.toString(); });
    child.on("error", (e) => {
      release();
      pendingCancelCtx = null;
      reject(e.code === "ENOENT" ? notFoundError() : e);
    });
    child.on("close", (code, signal) => {
      release();
      if (signal === "SIGTERM" || signal === "SIGKILL" || signal === "SIGINT") {
        const ctx = pendingCancelCtx;
        pendingCancelCtx = null;
        return reject(new CortexCancelledError(ctx));
      }
      pendingCancelCtx = null;
      if (code !== 0) reject(new Error(`cortex exited ${code}: ${err.trim()}`));
      else resolve(out.trim());
    });
  });
}

function notFoundError() {
  return new Error("cortex CLI not found. Install cortex and ensure it is on your PATH.");
}
