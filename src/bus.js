import { mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync, watchFile } from "fs";
import { join } from "path";
import { homedir } from "os";

const BUS_DIR  = join(homedir(), ".wrapper-bus");
const BUS_FILE = join(BUS_DIR, "messages.jsonl");
/** Appended when a user presses Ctrl+C — other persona processes watch and cancel their cortex run. */
const STOP_LOG = join(BUS_DIR, "cortex-stop.jsonl");

function readAll() {
  try {
    return readFileSync(BUS_FILE, "utf8")
      .split("\n")
      .flatMap((line) => { try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; } });
  } catch {
    return [];
  }
}

function readStops() {
  try {
    return readFileSync(STOP_LOG, "utf8")
      .split("\n")
      .flatMap((line) => { try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; } });
  } catch {
    return [];
  }
}

export function initBus() {
  mkdirSync(BUS_DIR, { recursive: true });
  if (!existsSync(BUS_FILE)) writeFileSync(BUS_FILE, "", "utf8");
  if (!existsSync(STOP_LOG)) writeFileSync(STOP_LOG, "", "utf8");
}

const STOP_LINE = (rec) => JSON.stringify(rec) + "\n";

/**
 * Call when this terminal receives Ctrl+C so the other session cancels an in-flight cortex run too.
 * The other process never calls this from the stop watcher (no ping-pong).
 */
export function broadcastCortexStop(fromName) {
  const from = String(fromName).toLowerCase();
  const rec    = {
    id:  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    from,
    kind: "cortexStop",
  };
  const line = STOP_LINE(rec);
  try {
    appendFileSync(STOP_LOG, line, "utf8");
  } catch (err) {
    if (err.code === "EBUSY" || err.code === "EPERM") {
      setTimeout(() => {
        try { appendFileSync(STOP_LOG, line, "utf8"); } catch { /* best effort */ }
      }, 120);
    } else {
      throw err;
    }
  }
}

/**
 * Fires for each new stop record that was *not* issued from `myName` (other person pressed Ctrl+C).
 */
export function watchCortexStop(myName, onOtherStopped) {
  const me   = myName.toLowerCase();
  const seen = new Set();
  for (const m of readStops()) { if (m.id) seen.add(m.id); }

  let processing = false;
  function check() {
    if (processing) return;
    processing = true;
    try {
      for (const m of readStops()) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        if (m.from && m.from !== me) {
          try { onOtherStopped(m); } catch { /* ignore */ }
        }
      }
    } catch { /* transient */ }
    processing = false;
  }

  watchFile(STOP_LOG, { interval: 200, persistent: true }, check);
  check();
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
