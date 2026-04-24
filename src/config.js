import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let _cache = null;

export function getConfig() {
  if (_cache) return _cache;
  try {
    _cache = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf8"));
  } catch {
    _cache = { personas: [{ name: "alex", title: "Data Engineer" }, { name: "dave", title: "Product Manager" }] };
  }
  return _cache;
}

export function getPersona(name) {
  const { personas } = getConfig();
  return personas.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

export function getOtherPersona(name) {
  const { personas } = getConfig();
  return personas.find((p) => p.name.toLowerCase() !== name.toLowerCase()) ?? personas[1];
}

export function validateName(name) {
  const { personas } = getConfig();
  const found = personas.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!found) {
    const names = personas.map((p) => p.name).join(", ");
    throw new Error(`Unknown persona "${name}". Available: ${names}`);
  }
  return found.name.toLowerCase();
}
