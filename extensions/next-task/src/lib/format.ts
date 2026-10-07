const MODEL_NAMES: Record<string, string> = {
  "claude-opus-5-5": "Opus 5.5",
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-fable-5-1": "Fable 5.1",
};

export function modelName(id: string): string {
  return MODEL_NAMES[id] ?? id;
}

/** "just now", "12 min ago", "3 h ago", "2 d ago". */
export function formatAge(thenMs: number, nowMs: number = Date.now()): string {
  const minutes = Math.floor((nowMs - thenMs) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** Elapsed time as m:ss, for the progress row. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

const clock = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** "16:00–16:25" in local time. */
export function formatTimeRange(startMs: number, endMs: number): string {
  return `${clock(startMs)}–${clock(endMs)}`;
}

/** "in 9 min", "in 1 h 20 min", "now", "started 3 min ago". */
export function formatStartsIn(startMs: number, nowMs: number = Date.now()): string {
  const minutes = Math.round((startMs - nowMs) / 60_000);
  if (minutes === 0) return "now";
  if (minutes < 0) return `started ${-minutes} min ago`;
  if (minutes < 60) return `in ${minutes} min`;
  const rest = minutes % 60;
  return `in ${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ""}`;
}

export function isLink(url: string): boolean {
  return /^https?:\/\//.test(url);
}
