import { homedir } from "os";

export function tildify(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}

export function escapeRegex(x: string): string {
  return x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wrap in single quotes for safe inclusion in a /bin/sh command string. */
export function shellQuote(x: string): string {
  return `'${x.replace(/'/g, `'\\''`)}'`;
}

/** Escape a string for embedding inside an AppleScript double-quoted string literal. */
export function applescriptQuote(x: string): string {
  return `"${x.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
