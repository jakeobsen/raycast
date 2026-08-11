import { trash } from "@raycast/api";
import { promises as fs } from "fs";
import { dirname, join, resolve } from "path";
import { generateName } from "./names";
import type { DeleteMode, ScratchPreferences } from "./prefs";

export const MARKER_FILE = ".scratch.json";
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Upper bound on entries visited while dating one folder. A `node_modules` tree can hold
 * six figures of files; past the cap we stop and report `truncated`, which callers treat as
 * "not stale" so an unfinished scan can never authorise a delete. */
const SCAN_ENTRY_CAP = 20_000;

export type ScratchMeta = {
  createdAt?: string;
  label?: string;
};

export type ScratchFolder = {
  name: string;
  path: string;
  /** Newest mtime found anywhere inside the folder (falls back to the folder's own mtime). */
  lastModifiedMs: number;
  /** True when the folder is untouched for at least the configured stale threshold. */
  stale: boolean;
  /** True when the scan hit SCAN_ENTRY_CAP, so lastModifiedMs is a lower bound only. */
  truncated: boolean;
  /** Present when the folder carries a .scratch.json marker written by Create Scratch. */
  meta?: ScratchMeta;
};

type Activity = { lastModifiedMs: number; fresh: boolean; truncated: boolean };

function isErrno(error: unknown, ...codes: string[]): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code !== undefined && codes.includes(code);
}

/**
 * Newest mtime inside `dir`, short-circuiting as soon as anything newer than `cutoffMs`
 * turns up — the stale/active decision needs no more than that, and active folders are the
 * ones expensive to walk. A directory's own mtime only tracks its direct children, so a
 * recursive walk is the only honest answer to "has anything in here changed?".
 */
export async function scanActivity(dir: string, cutoffMs: number): Promise<Activity> {
  let newest = 0;
  let visited = 0;

  try {
    newest = (await fs.lstat(dir)).mtimeMs;
  } catch {
    return { lastModifiedMs: 0, fresh: false, truncated: false };
  }
  if (newest > cutoffMs) return { lastModifiedMs: newest, fresh: true, truncated: false };

  const queue = [dir];
  while (queue.length > 0) {
    const current = queue.pop() as string;

    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      // Unreadable subtree (permissions, or it vanished mid-scan) — nothing to date here.
      if (isErrno(error, "ENOENT", "EACCES", "EPERM", "ELOOP", "ENOTDIR")) continue;
      throw error;
    }

    for (const entry of entries) {
      if (++visited > SCAN_ENTRY_CAP) return { lastModifiedMs: newest, fresh: false, truncated: true };

      const entryPath = join(current, entry.name);
      let stats;
      try {
        stats = await fs.lstat(entryPath);
      } catch {
        continue;
      }

      if (stats.mtimeMs > newest) newest = stats.mtimeMs;
      if (newest > cutoffMs) return { lastModifiedMs: newest, fresh: true, truncated: false };

      // Symlinked directories are deliberately not followed: they can leave the scratch
      // tree entirely and can loop.
      if (entry.isDirectory()) queue.push(entryPath);
    }
  }

  return { lastModifiedMs: newest, fresh: false, truncated: false };
}

/** List the scratch folders directly under the root, dated and classified stale/active. */
export async function listScratchFolders(root: string, staleDays: number, now: number = Date.now()) {
  const cutoffMs = now - staleDays * DAY_MS;

  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isErrno(error, "ENOENT")) return [] as ScratchFolder[];
    throw error;
  }

  // Only real, non-hidden directories one level down. Loose files and dotfolders in the
  // root are never candidates for deletion.
  const candidates = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));

  const folders = await Promise.all(
    candidates.map(async (entry): Promise<ScratchFolder> => {
      const path = join(root, entry.name);
      const [activity, meta] = await Promise.all([scanActivity(path, cutoffMs), readMeta(path)]);
      return {
        name: entry.name,
        path,
        lastModifiedMs: activity.lastModifiedMs,
        // A truncated scan never counts as stale — an unknown answer must not delete data.
        stale: !activity.fresh && !activity.truncated,
        truncated: activity.truncated,
        meta,
      };
    }),
  );

  return folders.sort((a, b) => a.lastModifiedMs - b.lastModifiedMs);
}

async function readMeta(path: string): Promise<ScratchMeta | undefined> {
  try {
    const raw = await fs.readFile(join(path, MARKER_FILE), "utf8");
    const parsed = JSON.parse(raw) as ScratchMeta;
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Create a uniquely named folder under the scratch root and drop a marker file in it.
 * Uniqueness comes from `mkdir` itself (no exists-then-create race): EEXIST means someone
 * else won, so try the next candidate.
 */
export async function createScratchFolder(prefs: ScratchPreferences, label?: string): Promise<string> {
  await fs.mkdir(prefs.scratchRoot, { recursive: true });

  for (let attempt = 0; attempt < 20; attempt++) {
    const base = generateName(prefs.nameStyle, label);
    // First few attempts re-roll the random name; after that, disambiguate with a counter.
    const name = attempt < 5 ? base : `${base}-${attempt - 3}`;
    const path = join(prefs.scratchRoot, name);

    try {
      await fs.mkdir(path);
    } catch (error) {
      if (isErrno(error, "EEXIST")) continue;
      throw error;
    }

    const meta: ScratchMeta = {
      createdAt: new Date().toISOString(),
      ...(label?.trim() ? { label: label.trim() } : {}),
    };
    await fs.writeFile(join(path, MARKER_FILE), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    return path;
  }

  throw new Error(`Could not find an unused folder name under ${prefs.scratchRoot}`);
}

/**
 * Guard against deleting anything that is not a direct child of the scratch root — a
 * mangled preference or a crafted path must not turn cleanup into `rm -rf` somewhere else.
 */
export function isDirectChildOf(root: string, path: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  return resolvedPath !== resolvedRoot && dirname(resolvedPath) === resolvedRoot;
}

/** Remove one scratch folder, via Trash (recoverable) or `rm -rf` semantics. */
export async function removeScratchFolder(root: string, path: string, mode: DeleteMode): Promise<void> {
  if (!isDirectChildOf(root, path)) {
    throw new Error(`Refusing to delete ${path}: not a direct child of ${root}`);
  }
  if (mode === "permanent") {
    await fs.rm(path, { recursive: true, force: true });
  } else {
    await trash(path);
  }
}

export function formatAge(ms: number, now: number = Date.now()): string {
  if (!ms) return "unknown";
  const days = Math.floor((now - ms) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}
