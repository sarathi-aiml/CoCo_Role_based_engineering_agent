# Cortex Code Personas Agent

Two AI personas running in separate terminals, having real back-and-forth conversations powered entirely by the `cortex-code` CLI. Names, roles, and titles are fully customizable via `config.json`.

---

## Requirements

- Node.js ≥ 18
- `cortex-code` CLI installed and on your PATH

No npm packages required — uses only Node.js built-ins.

---

## Setup

```bash
git clone https://github.com/sarathi-aiml/CoCo_Role_based_engineering_agent
cd CoCo_Role_based_engineering_agent
chmod +x bin/start.js bin/alex.js bin/dave.js
```

---

## Running

Open **two terminal windows** side by side.

```bash
# Terminal 1
node bin/start.js alex

# Terminal 2
node bin/start.js dave
```

Or install globally:
```bash
npm install -g .

cortex-persona alex   # Terminal 1
cortex-persona dave   # Terminal 2
```

The default personas are **Alex** (Data Engineer, cyan) and **Dave** (Product Manager, magenta).

---

## Custom names

To use your own persona names, edit `config.json`:

```json
{
  "personas": [
    { "name": "sarah", "title": "Backend Engineer" },
    { "name": "john",  "title": "Product Manager" }
  ]
}
```

Then add matching role files:

```
roles/sarah.md   ← sarah's personality and expertise
roles/john.md    ← john's personality and expertise
```

Run:
```bash
node bin/start.js sarah   # Terminal 1
node bin/start.js john    # Terminal 2
```

The first persona in `config.json` is always **cyan**, the second is **magenta**.

---

## Sending messages to the other agent

Type naturally — the wrapper detects your intent without any AI call:

```
tell dave to review the pipeline
dave, check the logs
ask alex about the schema
alex, what tables do we have?
say hello to alex
send the status update to dave
```

The message appears in the other terminal. They think and reply automatically. The conversation continues back and forth naturally (up to 6 exchanges per thread).

---

## Approval requests

Use approval keywords and the system flags it as a formal request:

```
ask dave to approve the new schema design
tell alex I need approval for the pipeline migration
```

- Approval request arrives with a **yellow ⚠ banner**
- The receiving agent auto-replies with **APPROVE** or **DENY** + a reason
- Decision arrives with a **green ✅ APPROVED** or **red ❌ DENIED** banner

---

## Local chat

Type anything without mentioning the other agent — it stays private between you and your own persona:

```
what SQL optimizations should I consider for this query?
how should I structure this feature spec?
walk me through the tradeoffs of this design
```

---

## Commands

| Command      | Description                        |
|--------------|------------------------------------|
| `/help`      | Show help and example phrases      |
| `/history`   | Show conversation history          |
| `/clear`     | Clear screen and reset history     |
| `/role`      | Show your persona's role prompt    |
| `/quit`      | Exit                               |

---

## Project structure

```
dual-cortex-wrapper/
├── bin/
│   ├── start.js           # Generic entry point: node bin/start.js <name>
│   ├── alex.js            # Shortcut for Alex
│   └── dave.js            # Shortcut for Dave
├── src/
│   ├── repl.js            # Terminal UI, chat loop, all rendering
│   ├── bus.js             # File-based IPC message bus
│   ├── cortex.js          # cortex-code CLI subprocess wrapper
│   ├── intentDetector.js  # Detects send/approval intent (no AI call)
│   ├── roleLoader.js      # Loads persona role from roles/*.md
│   └── config.js          # Reads config.json, resolves persona names
├── roles/
│   ├── alex.md            # Alex's persona and behavior
│   └── dave.md            # Dave's persona and behavior
├── config.json            # Persona names and titles — edit this to customize
└── package.json
```

---

## Role files

Each persona needs a file at `roles/<name>.md`. Write it in plain text — describe who they are, their expertise, and how they should behave. Example:

```
Your name is Sarah. You are a Backend Engineer.

Your expertise:
- REST and GraphQL API design
- Node.js, Python, PostgreSQL
- System design and performance tuning

How you work:
- Be direct and technical. Give concrete answers.
- When John sends a task, tackle it or ask one focused follow-up.
- Never end replies with a summary line.
```

---

## Message bus

Messages are stored at `~/.wrapper-bus/messages.jsonl` as newline-delimited JSON.

| Field                | Type    | Description                                     |
|----------------------|---------|-------------------------------------------------|
| `id`                 | string  | Unique message ID                               |
| `from`               | string  | Sender name                                     |
| `to`                 | string  | Recipient name                                  |
| `text`               | string  | Message content                                 |
| `isReply`            | boolean | True if part of a back-and-forth thread         |
| `isApprovalRequest`  | boolean | True if sender is requesting approval           |
| `isApprovalDecision` | boolean | True if this is an approve/deny decision        |
| `depth`              | number  | Thread depth (0 = first message, max 6)         |
| `timestamp`          | number  | Unix ms timestamp                               |

Reset the bus: `rm ~/.wrapper-bus/messages.jsonl`

---

## Display features

- **Chat bubbles** for your typed messages
- **Markdown rendering** in AI responses: bold, italic, inline code, H1–H3, bullet lists, numbered lists, tables
- **Word wrap** at terminal width — long lines never overflow
- **Braille spinner** while the AI is thinking
- **Color-coded by persona** — first in config = cyan, second = magenta
- **Approval banners** — yellow for requests, green/red for decisions

---

## Troubleshooting

**`cortex` not found** — install `cortex-code` and ensure it's on your PATH.

**Unknown persona error** — make sure the name in your command matches a name in `config.json`.

**Role file not found** — add `roles/<name>.md` for each persona in `config.json`.

**Messages not arriving** — make sure both terminals are running. Check `~/.wrapper-bus/messages.jsonl` exists.

**Conversation feels stale** — run `/clear` in the relevant terminal to reset that persona's history.

---

## License

MIT
