import { spawn } from "child_process";

const CORTEX_BIN = "cortex";

function buildPrompt(systemPrompt, history) {
  const historyText = history
    .map((h) => (h.role === "user" ? "User: " : "Assistant: ") + h.content)
    .join("\n");
  return systemPrompt + "\n\n---\n\n" + historyText + "\nAssistant:";
}

/**
 * Call cortex and return the full response text.
 * Simple pipe — no PTY, no streaming artefacts.
 */
export function askCortex(systemPrompt, history) {
  return new Promise((resolve, reject) => {
    const args  = ["--dangerously-allow-all-tool-calls", "-p", buildPrompt(systemPrompt, history)];
    const shell = process.platform === "win32";
    let   child;
    try   { child = spawn(CORTEX_BIN, args, { stdio: ["ignore", "pipe", "pipe"], shell }); }
    catch (err) { return reject(err.code === "ENOENT" ? notFoundError() : err); }

    let out = "", err = "";
    child.stdout.on("data", (c) => { out += c.toString(); });
    child.stderr.on("data", (c) => { err += c.toString(); });
    child.on("error", (e) => reject(e.code === "ENOENT" ? notFoundError() : e));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`cortex exited ${code}: ${err.trim()}`));
      else resolve(out.trim());
    });
  });
}

function notFoundError() {
  return new Error("cortex CLI not found. Install cortex and ensure it is on your PATH.");
}
