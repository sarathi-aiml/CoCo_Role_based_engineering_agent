import readline from "readline";
import { loadRole }                       from "./roleLoader.js";
import { askCortex, cancelActiveCortex, isCortexCancelledError } from "./cortex.js";
import { initBus, sendMessage, watchBus, broadcastCortexStop, watchCortexStop } from "./bus.js";
import { detectIntent }                   from "./intentDetector.js";
import { getConfig, getPersona, getOtherPersona } from "./config.js";

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  italic:  "\x1b[3m",
  cyan:    "\x1b[36m",
  magenta: "\x1b[35m",
  yellow:  "\x1b[33m",
  green:   "\x1b[32m",
  red:     "\x1b[31m",
  white:   "\x1b[37m",
};

const cols      = () => Math.min(process.stdout.columns || 80, 100);
const ts        = () => new Date().toLocaleTimeString("en-US", { hour12: false });
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// ─── Markdown → ANSI ─────────────────────────────────────────────────────────
function inlineMd(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g,  `${C.bold}$1${C.reset}`)
    .replace(/\*([^*\n]+?)\*/g, `${C.italic}$1${C.reset}`)
    .replace(/`([^`\n]+)`/g,    `\x1b[7m $1 ${C.reset}`);
}

function renderLine(line, clr) {
  if (/^#{1,2}\s+/.test(line))
    return `\n  ${C.bold}${clr}${inlineMd(line.replace(/^#{1,2}\s+/, ""))}${C.reset}`;
  if (/^#{3,}\s+/.test(line))
    return `  ${C.bold}${inlineMd(line.replace(/^#{3,}\s+/, ""))}${C.reset}`;
  if (/^(\s*)[-*+] /.test(line))
    return line.replace(/^(\s*)[-*+] (.*)$/, (_, sp, rest) =>
      `${sp}  ${clr}•${C.reset} ${inlineMd(rest)}`);
  if (/^(\s*)\d+\. /.test(line))
    return line.replace(/^(\s*)(\d+)\. (.*)$/, (_, sp, n, rest) =>
      `${sp}  ${C.bold}${n}.${C.reset} ${inlineMd(rest)}`);
  if (/^---+$/.test(line.trim()))
    return `  ${C.dim}${"─".repeat(cols() - 6)}${C.reset}`;
  return `  ${inlineMd(line)}`;
}

function renderTable(tableLines, clr) {
  const rows = tableLines
    .filter((l) => !/^\|[\s\-:|]+\|$/.test(l))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
  if (!rows.length) return tableLines.map((l) => `  ${l}`);

  const widths = rows.reduce((acc, row) => {
    row.forEach((cell, i) => { acc[i] = Math.max(acc[i] || 0, stripAnsi(inlineMd(cell)).length); });
    return acc;
  }, []);

  const pad = (cell, w) => {
    const rendered = inlineMd(cell);
    return rendered + " ".repeat(Math.max(0, w - stripAnsi(rendered).length));
  };

  const div = (l, m, r) =>
    `  ${clr}${l}${widths.map((w) => "─".repeat(w + 2)).join(m)}${r}${C.reset}`;

  const out = [div("┌", "┬", "┐")];
  rows.forEach((row, i) => {
    const cells = widths.map((w, j) => ` ${pad(row[j] ?? "", w)} `).join(`${clr}│${C.reset}`);
    out.push(`  ${clr}│${C.reset}${cells}${clr}│${C.reset}`);
    if (i === 0 && rows.length > 1) out.push(div("├", "┼", "┤"));
  });
  out.push(div("└", "┴", "┘"));
  return out;
}

function cleanReply(text) {
  return text
    .split("\n")
    .filter((l) => !/^(User|Assistant):\s*/.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderResponse(text, clr) {
  const maxW = cols() - 4;
  const out  = [];
  let tblock = [];

  function flushTable() {
    if (!tblock.length) return;
    renderTable(tblock, clr).forEach((l) => out.push(l));
    tblock = [];
  }

  function pushWrapped(line) {
    const isSpecial = /^(#{1,6}\s|[-*+]\s|\d+\.\s|---+$|\|)/.test(line.trim());
    if (!isSpecial && line.length > maxW) {
      const words = line.split(" ");
      let cur = "";
      for (const word of words) {
        if (cur && (cur + " " + word).length > maxW) {
          out.push(renderLine(cur, clr)); cur = word;
        } else {
          cur = cur ? cur + " " + word : word;
        }
      }
      if (cur) out.push(renderLine(cur, clr));
    } else {
      out.push(renderLine(line, clr));
    }
  }

  for (const line of text.split("\n")) {
    if (/^\|/.test(line)) { tblock.push(line); }
    else { flushTable(); pushWrapped(line); }
  }
  flushTable();
  return out;
}

// ─── Spinner ─────────────────────────────────────────────────────────────────
const FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
let _spin = null, _frame = 0;

function spinStart(label, clr) {
  _frame = 0;
  process.stdout.write("\n");
  _spin = setInterval(() => {
    process.stdout.write(`\r  ${clr}${FRAMES[_frame]}${C.reset}${C.dim}  ${label}${C.reset}  `);
    _frame = (_frame + 1) % FRAMES.length;
  }, 80);
}
function spinStop() {
  if (_spin) { clearInterval(_spin); _spin = null; }
  process.stdout.write("\r\x1b[K");
}

// ─── Output helpers ───────────────────────────────────────────────────────────
let _rl = null;
function print(lines) {
  if (_rl) { readline.cursorTo(process.stdout, 0); readline.clearLine(process.stdout, 0); }
  for (const l of (Array.isArray(lines) ? lines : [lines])) process.stdout.write(l + "\n");
}
function reprompt() { if (_rl) _rl.prompt(true); }

// ─── Timeline dot style ───────────────────────────────────────────────────────
function showChat(name, text, clr, time) {
  const lines = renderResponse(cleanReply(text), clr);
  print(`\n  ${clr}●${C.reset}  ${C.bold}${clr}${name}${C.reset}  ${C.dim}${time || ts()}${C.reset}`);
  lines.forEach((l) => print(`  ${C.dim}│${C.reset}${l}`));
  print(`  ${C.dim}│${C.reset}`);
}

// ─── Banner / help ────────────────────────────────────────────────────────────
function printBanner(name, title, clr, otherName) {
  const w    = cols();
  const date = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const inner = `  ${name.toUpperCase()}  ·  ${title}  ·  ${date}  `;
  console.log(`\n${clr}╔${"═".repeat(w - 2)}╗${C.reset}`);
  console.log(`${clr}║${C.reset}${inner.padEnd(w - 2)}${clr}║${C.reset}`);
  console.log(`${clr}╚${"═".repeat(w - 2)}╝${C.reset}\n`);
  console.log(`  ${C.dim}Type to chat  ·  /help${C.reset}`);
  console.log(`  ${C.dim}Message ${otherName}: "${otherName}, do X"  or  "tell ${otherName} about X"${C.reset}`);
  console.log(`  ${C.dim}Ctrl+C / Esc / new line: stop your run and the other session’s run${C.reset}\n`);
}

function printHelp(clr, otherName) {
  [
    "",
    `  ${C.bold}Commands${C.reset}`,
    `  ${clr}/help${C.reset}      Show this help`,
    `  ${clr}/history${C.reset}   Show conversation history`,
    `  ${clr}/clear${C.reset}     Clear screen & reset history`,
    `  ${clr}/role${C.reset}      Show your persona prompt`,
    `  ${clr}/quit${C.reset}      Exit`,
    "",
    `  ${C.bold}Send to ${otherName}${C.reset}`,
    `  ${C.dim}tell ${otherName} to review the work${C.reset}`,
    `  ${C.dim}${otherName}, check this out${C.reset}`,
    `  ${C.dim}ask ${otherName} about the plan${C.reset}`,
    "",
    `  ${C.bold}Approval requests${C.reset}`,
    `  ${C.dim}ask ${otherName} to approve this${C.reset}`,
    `  ${C.dim}→ ${otherName} will auto-reply APPROVE or DENY${C.reset}`,
    "",
  ].forEach((l) => console.log(l));
}

// ─── System prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(myName, otherName, rolePrompt) {
  const me    = myName.charAt(0).toUpperCase() + myName.slice(1);
  const other = otherName.charAt(0).toUpperCase() + otherName.slice(1);
  return (
    `You are ${me} in a live two-way chat with ${other}. Talk like a real person.\n` +
    `- You CANNOT send messages. Never say "I sent", "I forwarded", or "I'll relay".\n` +
    `- Respond naturally — ask follow-ups, share opinions, push back if needed.\n` +
    `- Keep replies short and direct (2-4 sentences). No bullet lists for simple answers.\n` +
    `- NEVER add a summary or "SUMMARY:" line at the end of your reply.\n` +
    `- When you see "[APPROVAL REQUEST from ${other.toLowerCase()}]", reply with APPROVE or DENY and one clear reason.\n\n` +
    rolePrompt
  );
}

// ─── Main REPL ────────────────────────────────────────────────────────────────
export async function startRepl(myName) {
  let role;
  try { role = loadRole(myName); }
  catch (err) { console.error(`\x1b[31mError: ${err.message}\x1b[0m`); process.exit(1); }

  const myPersona    = getPersona(myName);
  const otherPersona = getOtherPersona(myName);
  const otherName    = otherPersona.name;

  const { personas } = getConfig();
  const myIndex      = personas.findIndex((p) => p.name.toLowerCase() === myName.toLowerCase());
  const clr          = myIndex === 0 ? C.cyan : C.magenta;
  const otherClr     = myIndex === 0 ? C.magenta : C.cyan;

  const title     = myPersona?.title ?? myName;
  const history   = [];
  const sysPrompt = buildSystemPrompt(myName, otherName, role.systemPrompt);

  initBus();
  let peerStoppedAt = 0;  // timestamp of last stop signal from the other person
  watchCortexStop(myName, (m) => {
    const who = m.from
      ? m.from.charAt(0).toUpperCase() + m.from.slice(1).toLowerCase()
      : "Other session";
    // Extract the actual stop timestamp from the record id (format: "<ms>-<random>")
    peerStoppedAt = parseInt(m.id) || Date.now();
    const had = cancelActiveCortex({ remote: true, from: m.from });
    spinStop();
    print(`\n  ${C.yellow}⚡${C.reset}  ${C.bold}${C.yellow}${who} stopped${C.reset}${C.dim} — cancelling this run too.${C.reset}\n`);
    if (!had) reprompt();
  });

  const rl = readline.createInterface({
    input:    process.stdin,
    output:   process.stdout,
    prompt:   `\n${clr}${C.bold}${myName}>${C.reset} `,
    terminal: true,
  });
  _rl = rl;
  readline.emitKeypressEvents(process.stdin, rl);

  let busy           = false;
  let stopConvo      = false;
  let pendingReplyTo = null;   // set when a reply-to-peer run is interrupted
  const inputQueue   = [];
  const queue        = [];

  function fmtCortexErr(err) {
    if (isCortexCancelledError(err)) {
      if (err.remote) return "";  // message already shown by watchCortexStop
      return `\n  ${C.yellow}⚡${C.reset} ${C.dim}Stopped (cancelled).${C.reset}\n`;
    }
    return `\n  ${C.red}⚠  ${err.message}${C.reset}\n`;
  }

  function interruptRunningCortex() {
    cancelActiveCortex();
    spinStop();
    broadcastCortexStop(myName);
  }

  process.stdin.on("keypress", (_s, key) => {
    if (!key) return;
    if (key.name === "escape" && (_spin || busy)) {
      interruptRunningCortex();
    }
  });

  printBanner(myName, title, clr, otherName);
  rl.prompt();

  async function resumeAfterBusy() {
    busy = false;
    stopConvo = false;
    if (inputQueue.length) {
      const next = inputQueue.shift();
      await processUserInput(next);
    } else {
      drain();
      rl.prompt();
    }
  }

  // ── All user input logic in one place so it can be called both from readline
  //    and from the interrupt-replay path after a conversation is stopped ───────
  async function processUserInput(input) {
    if (input === "/quit" || input === "/exit") {
      console.log(`\n  ${C.dim}Goodbye.${C.reset}\n`); process.exit(0);
    }
    if (input === "/help")    { printHelp(clr, otherName); rl.prompt(); return; }
    if (input === "/clear")   { history.length = 0; console.clear(); printBanner(myName, title, clr, otherName); rl.prompt(); return; }
    if (input === "/role")    {
      console.log(`\n  ${clr}${C.bold}${myName.toUpperCase()}${C.reset} — ${title}\n`);
      console.log(`${C.dim}${role.systemPrompt}${C.reset}\n`);
      rl.prompt(); return;
    }
    if (input === "/history") {
      if (!history.length) { console.log(`\n  ${C.dim}No history yet.${C.reset}\n`); }
      else {
        console.log(`\n  ${C.bold}History:${C.reset}`);
        history.forEach((h) => {
          const who = h.role === "user" ? `${C.dim}you${C.reset}` : `${clr}${myName}${C.reset}`;
          const txt = h.content.length > 120 ? h.content.slice(0, 120) + "…" : h.content;
          console.log(`  ${who}: ${txt}`);
        });
        console.log("");
      }
      rl.prompt(); return;
    }

    // Echo user input in timeline style
    print(`\n  ${clr}●${C.reset}  ${C.bold}${clr}${myName.toUpperCase()}${C.reset}  ${C.dim}${ts()}${C.reset}`);
    print(`  ${C.dim}│  ${input}${C.reset}`);
    print(`  ${C.dim}│${C.reset}`);

    const intent  = detectIntent(input, myName, otherName);
    const target  = intent.isSend ? intent.target : pendingReplyTo;

    if (target) {
      pendingReplyTo = null;
      busy = true;
      spinStart(`Writing message to ${target}…`, clr);

      let payload      = intent.isSend ? intent.payload : input;
      const isApproval = !!(intent.isSend && intent.isApproval);
      try {
        const prompt =
          `You are ${myName}. Write a short, natural, respectful message to ${target} that conveys:\n"${payload}"\n\n` +
          `Rules: Address ${target} by name. Sound like a real person, not a template. One to three sentences max. Output only the message, nothing else.`;
        payload = await askCortex(sysPrompt, [{ role: "user", content: prompt }]);
        payload = cleanReply(payload);
      } catch (err) {
        if (isCortexCancelledError(err)) {
          spinStop();
          const _msg = fmtCortexErr(err); if (_msg) print(_msg);
          await resumeAfterBusy();
          return;
        }
        /* keep original on other error */
      }
      spinStop();

      spinStart(`Sending to ${target}…`, clr);
      try {
        await sendMessage(myName, target, payload, {
          isApprovalRequest: isApproval,
          depth: 0,
        });
      } catch (err) {
        spinStop(); print(`\n  ${C.red}⚠  ${err.message}${C.reset}\n`);
        await resumeAfterBusy(); return;
      }
      spinStop();

      history.push({ role: "user", content: `(sent to ${target}): ${input}` });
      await resumeAfterBusy();
      return;
    }

    // Local chat with own persona
    busy = true;
    spinStart("Thinking…", clr);
    history.push({ role: "user", content: input });
    let reply;
    try {
      reply = await askCortex(sysPrompt, history);
      history.push({ role: "assistant", content: reply });
    } catch (err) {
      history.pop();
      spinStop();
      const _msg = fmtCortexErr(err); if (_msg) print(_msg);
      await resumeAfterBusy();
      return;
    }
    spinStop();
    showChat(myName.toUpperCase(), reply, clr);
    await resumeAfterBusy();
  }

  async function processIncoming(msg) {
    busy = true;
    spinStop();

    const msgTs = new Date(msg.timestamp).toLocaleTimeString("en-US", { hour12: false });

    if (msg.isApprovalDecision) {
      const approved = /\bAPPROVE[DS]?\b/i.test(msg.text);
      const dclr     = approved ? C.green : C.red;
      const verdict  = approved ? "✅  APPROVED" : "❌  DENIED";
      showChat(`${msg.from.toUpperCase()}  ${verdict}`, msg.text, dclr, msgTs);
    } else if (msg.isApprovalRequest) {
      showChat(`${msg.from.toUpperCase()}  ⚠  APPROVAL REQUEST`, msg.text, C.yellow, msgTs);
    } else {
      showChat(msg.from.toUpperCase(), msg.text, otherClr, msgTs);
    }

    const MAX_DEPTH = 50;  // effectively unlimited — user can interrupt anytime
    const depth     = msg.depth ?? 0;

    if (!msg.isApprovalDecision && depth < MAX_DEPTH && !stopConvo && msg.timestamp > peerStoppedAt) {
      const label = msg.isApprovalRequest
        ? `[APPROVAL REQUEST from ${msg.from}]: ${msg.text}`
        : `[Message from ${msg.from}]: ${msg.text}`;

      pendingReplyTo = msg.from;
      spinStart("Thinking…", otherClr);
      history.push({ role: "user", content: label });
      let reply;
      try {
        reply = await askCortex(sysPrompt, history);
        history.push({ role: "assistant", content: reply });
      } catch (err) {
        history.pop();
        spinStop();
        const _msg = fmtCortexErr(err); if (_msg) print(_msg);
        busy = false;
        if (inputQueue.length) {
          const next = inputQueue.shift();
          await processUserInput(next);
        } else {
          drain();
          reprompt();
        }
        return;
      }
      spinStop();

      if (reply) {
        const replyLabel = msg.isApprovalRequest ? `${myName.toUpperCase()}  (approval decision)` : myName.toUpperCase();
        showChat(replyLabel, reply, clr);

        await sendMessage(myName, msg.from, reply, {
          isReply:            true,
          isApprovalDecision: msg.isApprovalRequest,
          depth:              depth + 1,
        });
        pendingReplyTo = null;
      }
    }

    if (stopConvo) {
      stopConvo    = false;
      queue.length = 0;  // drop queued agent messages
    }

    busy = false;

    // Process any user input that was typed while we were busy
    if (inputQueue.length) {
      const saved = inputQueue.shift();
      await processUserInput(saved);
    } else {
      drain(); reprompt();
    }
  }

  function drain() { if (queue.length && !busy) processIncoming(queue.shift()); }

  watchBus(myName, (msg) => {
    if (busy) queue.push(msg);
    else processIncoming(msg);
  });

  rl.on("line", async (raw) => {
    const input = raw.trim();
    if (!input) { rl.prompt(); return; }

    if (busy) {
      stopConvo = true;
      cancelActiveCortex();
      spinStop();
      broadcastCortexStop(myName);
      inputQueue.push(input);
      print(`\n  ${C.yellow}⚡${C.reset} ${C.dim}Stopping run… your message is next:${C.reset}`);
      print(`  ${C.dim}│  ${input}${C.reset}`);
      print(`  ${C.dim}│${C.reset}`);
      rl.prompt();
      return;
    }

    await processUserInput(input);
  });

  rl.on("SIGINT", () => {
    cancelActiveCortex();
    spinStop();
    broadcastCortexStop(myName);
    console.log("");
    rl.prompt();
  });
  rl.on("close", () => process.exit(0));
}
