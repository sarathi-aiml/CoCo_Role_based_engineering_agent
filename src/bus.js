import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync, watchFile } from "fs";
import { join } from "path";
import { homedir } from "os";

const BUS_DIR  = join(homedir(), ".wrapper-bus");
const BUS_FILE = join(BUS_DIR, "messages.jsonl");

function readAll() {
  try {
    return readFileSync(BUS_FILE, "utf8")
      .split("\n")
      .flatMap((line) => { try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; } });
  } catch {
    return [];
  }
}

export function initBus() {
  mkdirSync(BUS_DIR, { recursive: true });
  if (!existsSync(BUS_FILE)) writeFileSync(BUS_FILE, "", "utf8");
}

export async function sendMessage(from, to, text, { isReply = false, isApprovalRequest = false, isApprovalDecision = false, depth = 0 } = {}) {
  const msg = {
    id:        `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    from, to, text,
    isReply, isApprovalRequest, isApprovalDecision, depth,
    timestamp: Date.now(),
  };
  try {
    appendFileSync(BUS_FILE, JSON.stringify(msg) + "\n", "utf8");
  } catch (err) {
    if (err.code === "EBUSY" || err.code === "EPERM") {
      await new Promise((r) => setTimeout(r, 120));
      appendFileSync(BUS_FILE, JSON.stringify(msg) + "\n", "utf8");
    } else {
      throw err;
    }
  }
}

export function watchBus(myName, onMessage) {
  const seen = new Set(
    readAll().filter((m) => m.to === myName).map((m) => m.id)
  );
  let processing = false;

  async function check() {
    if (processing) return;
    processing = true;
    try {
      const pending = readAll().filter((m) => m.to === myName && !seen.has(m.id));
      for (const msg of pending) {
        seen.add(msg.id);
        try { await onMessage(msg); } catch { /* don't crash the watcher */ }
      }
    } catch { /* transient read error */ }
    processing = false;
  }

  watchFile(BUS_FILE, { interval: 300, persistent: true }, check);
}
