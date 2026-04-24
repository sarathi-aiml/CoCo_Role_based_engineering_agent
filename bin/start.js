#!/usr/bin/env node
import { startRepl } from "../src/repl.js";
import { validateName } from "../src/config.js";

const name = process.argv[2];
if (!name) {
  console.error("Usage: node bin/start.js <persona-name>");
  console.error("Example: node bin/start.js alex");
  process.exit(1);
}

try {
  startRepl(validateName(name));
} catch (err) {
  console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
  process.exit(1);
}
