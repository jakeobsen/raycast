import { homedir } from "os";

/** Replace $HOME with ~ for display. */
export function tildify(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}
