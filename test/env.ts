/**
 * Loads a local .env into process.env for tests and the eval runner. Values
 * already in the environment win. No dependency; the file is KEY=VALUE lines.
 */
import { existsSync, readFileSync } from "node:fs";

export function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env) && value) process.env[key] = value;
  }
}

loadDotEnv();
