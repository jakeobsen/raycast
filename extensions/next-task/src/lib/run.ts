import { environment } from "@raycast/api";
import { spawn } from "child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir, userInfo } from "os";
import { join } from "path";
import { StringDecoder } from "string_decoder";
import type { NextTaskPreferences } from "./prefs";
import { buildArgs, REQUIRED_SERVERS, type Answer, type Workflow, type WorkflowSource } from "./prompt";
import type { SavedItem } from "./saved-store";

/**
 * A run is a detached `claude -p` process writing stream-json to a file in the support
 * directory, so it keeps going when Raycast closes the window and the view can pick it up
 * again on the next open. When a run ends, its JSON (stream, meta and the outcome) moves to
 * history/ for debugging and is deleted after HISTORY_DAYS. The stream holds raw Slack, mail
 * and Jira content, so nothing keeps it longer than that.
 */

export type StoredResult = {
  answer: Answer;
  /** Model that did the work, read from the run's usage data rather than self-reported. */
  model: string;
  durationMs: number;
  costUsd: number;
  /** Tool calls the permission layer refused — non-empty means the prompt reached for a write. */
  denied: string[];
  /**
   * Tool results too large to reach the model (e.g. "a Slack channel"), so the answer may have
   * missed something. Missing on answers saved before this was tracked.
   */
  unreadable?: string[];
  /** Whether the run used the saved workflow or fell back to the example. */
  workflow: WorkflowSource;
  finishedAt: number;
};

export type StoredError = { message: string; at: number };

export type RunProgress = {
  startedAt: number;
  label: string;
  steps: number;
  workflow: WorkflowSource;
  unknownPlaceholders: string[];
};

type RunMeta = { pid: number; startedAt: number; workflow: WorkflowSource; unknownPlaceholders: string[] };

/** A run still going after this long is treated as hung and stopped. */
const MAX_RUN_MS = 10 * 60 * 1000;

/** Finished runs are kept this long, then deleted. */
const HISTORY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const runDir = () => join(environment.supportPath, "run");
const historyDir = () => join(environment.supportPath, "history");
const metaPath = () => join(runDir(), "meta.json");
const streamPath = () => join(runDir(), "stream.jsonl");
const stderrPath = () => join(runDir(), "stderr.log");
const resultPath = () => join(environment.supportPath, "last-result.json");
const errorPath = () => join(environment.supportPath, "last-error.json");

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export const loadResult = () => readJson<StoredResult>(resultPath());
export const loadError = () => readJson<StoredError>(errorPath());
const readMeta = () => readJson<RunMeta>(metaPath());

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the pid exists but belongs to someone else — still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Raycast's environment has no USER/LOGNAME, a minimal PATH, and an ICU-style LC_ALL that
 * shells can't parse. USER matters most: claude looks up its keychain login by $USER and
 * reports "Not logged in" without it.
 */
function claudeEnv(): NodeJS.ProcessEnv {
  const username = userInfo().username;
  const path = [
    join(homedir(), ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH ?? "",
    "/usr/bin:/bin:/usr/sbin:/sbin",
  ]
    .filter(Boolean)
    .join(":");
  return {
    ...process.env,
    HOME: process.env.HOME || homedir(),
    USER: process.env.USER || username,
    LOGNAME: process.env.LOGNAME || username,
    PATH: path,
    LC_ALL: "en_US.UTF-8",
    LANG: process.env.LANG || "en_US.UTF-8",
    // Without these, -p mode only waits briefly for MCP servers and the claude.ai connectors
    // are often missing from the run (1 in 3 loaded in testing; 3 in 3 with these set).
    MCP_CONNECTION_NONBLOCKING: "false",
    MCP_TIMEOUT: "30000",
    // Past this, Claude Code saves a tool result to a file instead of handing it to the model,
    // and with file tools disabled the model can't read it back. A 100-message Slack channel
    // read (~59k characters) went over the default.
    MAX_MCP_OUTPUT_TOKENS: "80000",
  };
}

/** Start a run unless one is already going. Throws if the CLI can't be launched. */
export function startRun(prefs: NextTaskPreferences, workflow: Workflow, saved: SavedItem[]): void {
  const meta = readMeta();
  if (meta && isAlive(meta.pid)) return;
  if (!existsSync(prefs.claudePath)) {
    throw new Error(`No claude binary at ${prefs.claudePath}. Set Claude CLI Path in the extension preferences.`);
  }

  // A run folder with no live process is one nobody polled to the end; keep it for debugging.
  archive("abandoned");
  rmSync(errorPath(), { force: true });
  mkdirSync(runDir(), { recursive: true });

  const now = new Date();
  const out = openSync(streamPath(), "w");
  const err = openSync(stderrPath(), "w");
  try {
    // detached puts claude in its own process group, so stopRun can signal the whole group
    // (claude plus any MCP helpers it spawned) and closing Raycast doesn't take it down.
    const child = spawn(prefs.claudePath, buildArgs(prefs, now, workflow, saved), {
      cwd: homedir(),
      detached: true,
      stdio: ["ignore", out, err],
      env: claudeEnv(),
    });
    child.on("error", () => undefined);
    if (child.pid === undefined) throw new Error(`Could not start ${prefs.claudePath}.`);
    child.unref();
    const meta: RunMeta = {
      pid: child.pid,
      startedAt: now.getTime(),
      workflow: workflow.source,
      unknownPlaceholders: workflow.unknown,
    };
    writeFileSync(metaPath(), JSON.stringify(meta));
  } finally {
    closeSync(out);
    closeSync(err);
  }
}

function killGroup(pid: number) {
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

/** Stop the current run without recording an error. */
export function stopRun(): void {
  const meta = readMeta();
  if (meta) killGroup(meta.pid);
  archive("stopped");
}

function fail(message: string) {
  const error: StoredError = { message, at: Date.now() };
  writeFileSync(errorPath(), JSON.stringify(error));
  archive("error", { name: "error.json", data: error });
}

function ensureHistoryDir(): string {
  mkdirSync(historyDir(), { recursive: true });
  return historyDir();
}

/** "2026-10-07_15-39-12" in local time: sortable, and safe as a folder name. */
function stamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

/** Move the run folder into history as `<start time>-<outcome>`, then drop entries past HISTORY_DAYS. */
function archive(outcome: "success" | "error" | "stopped" | "abandoned", extra?: { name: string; data: unknown }) {
  if (!existsSync(runDir())) return;
  if (extra) writeFileSync(join(runDir(), extra.name), JSON.stringify(extra.data, null, 2));
  // History keeps the JSON only. An error's stderr already lives on in error.json's message.
  rmSync(stderrPath(), { force: true });
  let destination = join(ensureHistoryDir(), `${stamp(readMeta()?.startedAt ?? Date.now())}-${outcome}`);
  if (existsSync(destination)) destination += `-${Date.now()}`;
  // A rename keeps any still-open file handle valid, so a run being stopped can't fail the move.
  renameSync(runDir(), destination);
  pruneHistory();
}

function pruneHistory(now: number = Date.now()) {
  const cutoff = now - HISTORY_DAYS * DAY_MS;
  let entries;
  try {
    entries = readdirSync(historyDir(), { withFileTypes: true });
  } catch {
    return;
  }
  // Only direct child folders of history/ are ever candidates.
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(historyDir(), entry.name);
    try {
      if (statSync(path).mtimeMs < cutoff) rmSync(path, { recursive: true, force: true });
    } catch {
      // Vanished in the meantime — nothing to prune.
    }
  }
}

function lastLines(path: string, maxChars = 600): string {
  try {
    return readFileSync(path, "utf8").trim().slice(-maxChars);
  } catch {
    return "";
  }
}

type ResultEvent = {
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: Answer;
  duration_ms?: number;
  total_cost_usd?: number;
  modelUsage?: Record<string, { costUSD?: number }>;
  permission_denials?: { tool_name?: string }[];
};

type McpServer = { name?: string; status?: string };

/** Claude Code also bills a small background model, so the main model is the one that cost the most. */
function mainModel(usage: ResultEvent["modelUsage"]): string {
  const entries = Object.entries(usage ?? {});
  if (entries.length === 0) return "unknown";
  return entries.reduce((a, b) => ((b[1].costUSD ?? 0) > (a[1].costUSD ?? 0) ? b : a))[0];
}

function finish(event: ResultEvent, meta: RunMeta, unreadable: string[]) {
  if (event.is_error || event.subtype !== "success" || !event.structured_output) {
    fail(event.result?.trim() || `Claude stopped without an answer (${event.subtype ?? "unknown"}).`);
    return;
  }
  const result: StoredResult = {
    answer: event.structured_output,
    model: mainModel(event.modelUsage),
    durationMs: event.duration_ms ?? 0,
    costUsd: event.total_cost_usd ?? 0,
    denied: (event.permission_denials ?? []).map((denial) => denial.tool_name ?? "unknown"),
    unreadable,
    workflow: meta.workflow,
    finishedAt: Date.now(),
  };
  writeFileSync(resultPath(), JSON.stringify(result));
  archive("success", { name: "result.json", data: result });
}

/** What the run is doing, phrased for the progress row. */
function describeTool(name: string): string {
  const tool = name.split("__").pop() ?? name;
  if (tool === "list_events" || tool === "get_event") return "Checking your calendar";
  if (tool === "searchJiraIssuesUsingJql" || tool === "getJiraIssue") return "Reading Jira";
  if (tool === "slack_read_canvas") return "Reading a Slack canvas";
  if (tool === "slack_read_channel") return "Reading a Slack channel";
  if (tool === "slack_read_thread") return "Reading a Slack thread";
  if (tool.startsWith("slack_search")) return "Searching Slack";
  if (tool === "search_threads" || tool === "get_thread") return "Checking Gmail";
  return "Working";
}

/** What a tool reads, for the "couldn't read" note: "a Slack channel", "a Jira search". */
function describeSource(name: string): string {
  const tool = name.split("__").pop() ?? name;
  if (tool === "list_events" || tool === "get_event") return "your calendar";
  if (tool === "searchJiraIssuesUsingJql") return "a Jira search";
  if (tool === "getJiraIssue") return "a Jira ticket";
  if (tool === "slack_read_canvas") return "a Slack canvas";
  if (tool === "slack_read_channel") return "a Slack channel";
  if (tool === "slack_read_thread") return "a Slack thread";
  if (tool.startsWith("slack_search")) return "a Slack search";
  if (tool === "search_threads") return "a Gmail search";
  if (tool === "get_thread") return "an email thread";
  return tool || "a tool result";
}

/** Claude Code's wording when a tool result is too big and gets saved to a file instead. */
const OVERSIZED_RESULT = /exceeds maximum allowed tokens/i;

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  return "";
}

/**
 * Follows the current run's stream file. Each poll reads only the bytes appended since the
 * last one; when the run ends it records the answer (or the error) and returns undefined.
 */
export class RunWatcher {
  private startedAt?: number;
  private offset = 0;
  private decoder = new StringDecoder("utf8");
  private partial = "";
  private steps = 0;
  private label = "Waiting for connectors";
  private final?: ResultEvent;
  private missing?: string[];
  /** tool_use id → tool name, to say which result was too large. */
  private toolNames = new Map<string, string>();
  private unreadable: string[] = [];

  private reset(startedAt: number) {
    this.startedAt = startedAt;
    this.offset = 0;
    this.decoder = new StringDecoder("utf8");
    this.partial = "";
    this.steps = 0;
    this.label = "Waiting for connectors";
    this.final = undefined;
    this.missing = undefined;
    this.toolNames = new Map();
    this.unreadable = [];
  }

  poll(): RunProgress | undefined {
    const meta = readMeta();
    if (!meta) return undefined;
    if (meta.startedAt !== this.startedAt) this.reset(meta.startedAt);

    this.readNew();
    if (this.final) {
      finish(this.final, meta, this.unreadable);
      return undefined;
    }
    if (this.missing && this.missing.length > 0) {
      // Without these the answer would quietly skip a source, so stop now rather than pay for it.
      killGroup(meta.pid);
      fail(`These connectors didn't load: ${this.missing.join(", ")}. Ask again with ⌘R.`);
      return undefined;
    }
    if (!isAlive(meta.pid)) {
      // It may have written the result line between our read and its exit.
      this.readNew();
      if (this.final) finish(this.final, meta, this.unreadable);
      else fail(lastLines(stderrPath()) || "Claude exited without an answer.");
      return undefined;
    }
    if (Date.now() - meta.startedAt > MAX_RUN_MS) {
      killGroup(meta.pid);
      fail(`Claude was still going after ${MAX_RUN_MS / 60_000} minutes, so the run was stopped.`);
      return undefined;
    }
    return {
      startedAt: meta.startedAt,
      label: this.label,
      steps: this.steps,
      workflow: meta.workflow,
      unknownPlaceholders: meta.unknownPlaceholders ?? [],
    };
  }

  private readNew() {
    let fd: number;
    try {
      fd = openSync(streamPath(), "r");
    } catch {
      return;
    }
    try {
      const size = fstatSync(fd).size;
      if (size <= this.offset) return;
      const chunk = Buffer.alloc(size - this.offset);
      readSync(fd, chunk, 0, chunk.length, this.offset);
      this.offset = size;
      // StringDecoder holds back a multi-byte character split across two reads.
      const lines = (this.partial + this.decoder.write(chunk)).split("\n");
      this.partial = lines.pop() ?? "";
      for (const line of lines) this.handle(line);
    } finally {
      closeSync(fd);
    }
  }

  private handle(line: string) {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === "system" && event.subtype === "init") {
      const servers: McpServer[] = event.mcp_servers ?? [];
      this.missing = REQUIRED_SERVERS.filter(
        (name) => servers.find((server) => server.name === name)?.status !== "connected",
      ).map((name) => name.replace(/^claude\.ai /, ""));
      this.label = "Thinking";
    } else if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if (block.type !== "tool_use") continue;
        this.steps++;
        this.label = describeTool(block.name ?? "");
        if (block.id) this.toolNames.set(block.id, block.name ?? "");
      }
    } else if (event.type === "user") {
      // Tool results come back as user messages. One that was too big never reached the model.
      for (const block of event.message?.content ?? []) {
        if (block.type !== "tool_result" || !OVERSIZED_RESULT.test(toolResultText(block.content))) continue;
        this.unreadable.push(describeSource(this.toolNames.get(block.tool_use_id) ?? ""));
      }
    } else if (event.type === "result") {
      this.final = event;
    }
  }
}
