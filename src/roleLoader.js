import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

/**
 * Load a role definition from roles/<myName>.md.
 *
 * @param {string} myName - "alex" or "dave"
 * @returns {{ name: string, systemPrompt: string }}
 */
export function loadRole(myName) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packageRoot = join(__dirname, "..");
  const rolePath = join(packageRoot, "roles", `${myName}.md`);

  let contents;
  try {
    contents = readFileSync(rolePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `Role file not found: roles/${myName}.md. Cannot start without an identity.`
      );
    }
    throw err;
  }

  const trimmed = contents.trim();

  if (trimmed.length < 20) {
    throw new Error(
      `Role file for ${myName} appears empty or invalid.`
    );
  }

  const name = myName.charAt(0).toUpperCase() + myName.slice(1);
  return { name, systemPrompt: trimmed };
}
