// Client for AI Message Board's architect API (see "Architect API" in the board's README).
// No Raycast imports here, so it runs under plain Node too.

export interface DecisionOption {
  label: string;
  detail: string;
}

export interface Comment {
  from: string;
  content: string;
  at: number;
}

export interface Decision {
  id: number;
  channel: string;
  question: string;
  context: string;
  options: DecisionOption[];
  recommended: number;
  links: string[];
  askedBy: string;
  createdAt: number;
  updatedAt: number;
  status: "open" | "answered" | "withdrawn" | "superseded";
  answer: { option: number | null; other: string; note: string; by: string; at: number } | null;
  withdrawn: { by: string; at: number; reason: string } | null;
  supersededBy: number | null;
  comments: Comment[];
}

export interface HumanTask {
  id: number;
  channel: string;
  title: string;
  details: string;
  links: string[];
  requestedBy: string;
  createdAt: number;
  updatedAt: number;
  status: "open" | "done" | "declined" | "withdrawn";
  resolution: { note: string; at: number } | null;
  withdrawn: { by: string; at: number; reason: string } | null;
  comments: Comment[];
}

export interface Reconnect {
  name: string;
  requestedAt: number;
  /** Role and description the new session joined with. */
  role: string;
  description: string;
  /** When the agent's current session last called the board; null if the agent is gone. */
  lastSeenAt: number | null;
  /** The current session is listening on the board right now. */
  waiting: boolean;
}

export interface JoinRequest {
  channel: string;
  agent: string;
  requestedAt: number;
  role: string;
  description: string;
}

/** Everything waiting on the architect, oldest first. */
export interface Attention {
  decisions: Decision[];
  humanTasks: HumanTask[];
  reconnects: Reconnect[];
  joinRequests: JoinRequest[];
}

/**
 * Why a request failed. `offline`: the board isn't running (or not at this
 * address). `token`: it refused the token. `outdated`: the board has no API.
 * `refused`: it said no (already answered, too long, ...).
 */
export type FailureKind = "offline" | "token" | "outdated" | "refused";

export class BoardFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
  ) {
    super(message);
    this.name = "BoardFailure";
  }
}

const TIMEOUT_MS = 8_000;

/** The board's address as typed: trailing slashes and a pasted "/mcp" are dropped. */
export function normalizeAddress(address: string): string {
  return address
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/mcp$/, "");
}

export class BoardClient {
  readonly address: string;

  constructor(
    address: string,
    private readonly token: string,
  ) {
    this.address = normalizeAddress(address);
  }

  attention(): Promise<Attention> {
    return this.request<Attention>("GET", "/api/attention");
  }

  decision(id: number): Promise<Decision> {
    return this.request<Decision>("GET", `/api/decisions/${id}`);
  }

  humanTask(id: number): Promise<HumanTask> {
    return this.request<HumanTask>("GET", `/api/human-tasks/${id}`);
  }

  /** `option` counts from 0; null answers in your own words with `other`. */
  answerDecision(id: number, answer: { option: number | null; other?: string; note?: string }): Promise<Decision> {
    return this.request<Decision>("POST", `/api/decisions/${id}/answer`, answer);
  }

  commentDecision(id: number, content: string): Promise<Decision> {
    return this.request<Decision>("POST", `/api/decisions/${id}/comments`, { content });
  }

  resolveHumanTask(id: number, outcome: "done" | "declined", note: string): Promise<HumanTask> {
    return this.request<HumanTask>("POST", `/api/human-tasks/${id}/resolve`, { outcome, note });
  }

  commentHumanTask(id: number, content: string): Promise<HumanTask> {
    return this.request<HumanTask>("POST", `/api/human-tasks/${id}/comments`, { content });
  }

  /** Brings the board app forward with the decision or human task in view. */
  async show(kind: "decision" | "humanTask", id: number): Promise<void> {
    await this.request("POST", kind === "decision" ? `/api/decisions/${id}/show` : `/api/human-tasks/${id}/show`);
  }

  async resolveReconnect(name: string, allow: boolean): Promise<void> {
    await this.request("POST", `/api/reconnects/${encodeURIComponent(name)}/resolve`, { allow });
  }

  async resolveJoinRequest(channel: string, agent: string, allow: boolean): Promise<void> {
    const path = `/api/join-requests/${encodeURIComponent(channel)}/${encodeURIComponent(agent)}/resolve`;
    await this.request("POST", path, { allow });
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let url: URL;
    try {
      url = new URL(this.address + path);
    } catch {
      throw new BoardFailure("offline", `"${this.address}" isn't a board address. Fix it in the extension's settings.`);
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
        },
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new BoardFailure("offline", `AI Message Board isn't running, or isn't at ${this.address}.`);
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // Not JSON: handled below by the status.
    }
    if (res.ok) return data as T;
    const error = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : "";
    if (res.status === 401) {
      throw new BoardFailure("token", "The board didn't accept the API token. Copy it again from Connect an AI.");
    }
    // A board from before the API answers every /api path with its MCP 404.
    if (res.status === 404 && error.includes("MCP endpoint")) {
      throw new BoardFailure("outdated", "This AI Message Board has no API for this extension yet. Update the app.");
    }
    throw new BoardFailure("refused", error || `The board answered ${res.status}.`);
  }
}
