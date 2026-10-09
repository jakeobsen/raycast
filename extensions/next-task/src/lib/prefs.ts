import { getPreferenceValues } from "@raycast/api";
import { homedir } from "os";
import { isAbsolute, join, normalize } from "path";

export type Model = "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-fable-5-1";
export type Effort = "low" | "medium" | "high" | "xhigh";

type RawPreferences = {
  model?: Model;
  effort?: Effort;
  reuseMinutes?: string;
  meetingWindowMinutes?: string;
  saveForLater?: boolean;
  resolvedEmojis?: string;
  claudePath?: string;
};

export type NextTaskPreferences = {
  model: Model;
  effort: Effort;
  reuseMinutes: number;
  meetingWindowMinutes: number;
  /** Save for Later: the actions, the Saved section, and sending the saved list to Claude. */
  saveForLater: boolean;
  resolvedEmojis: string[];
  claudePath: string;
};

export const DEFAULT_REUSE_MINUTES = 30;
export const DEFAULT_MEETING_WINDOW_MINUTES = 60;

/** Blank or garbage falls back; 0 is kept as a legitimate answer. */
function parseMinutes(input: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat((input ?? "").trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Fallback for a blank Resolved Reactions preference. Team-specific emoji belong in the preference itself. */
export const DEFAULT_RESOLVED_EMOJIS = ["white_check_mark", "heavy_check_mark"];

/** "white_check_mark, :merged:" → ["white_check_mark", "merged"]; blank falls back to the defaults. */
function parseEmojis(input: string | undefined): string[] {
  const names = (input ?? "")
    .split(/[\s,]+/)
    .map((name) => name.replace(/^:|:$/g, ""))
    .filter(Boolean);
  return names.length > 0 ? names : DEFAULT_RESOLVED_EMOJIS;
}

/** Expand a leading ~ and resolve to an absolute path; relative input is taken from $HOME. */
function resolvePath(input: string | undefined, fallback: string): string {
  const raw = (input ?? "").trim() || fallback;
  if (raw.startsWith("~/")) return normalize(join(homedir(), raw.slice(2)));
  if (isAbsolute(raw)) return normalize(raw);
  return normalize(join(homedir(), raw));
}

export function getPreferences(): NextTaskPreferences {
  const prefs = getPreferenceValues<RawPreferences>();
  return {
    model: prefs.model ?? "claude-opus-5-5",
    effort: prefs.effort ?? "medium",
    reuseMinutes: parseMinutes(prefs.reuseMinutes, DEFAULT_REUSE_MINUTES),
    meetingWindowMinutes: parseMinutes(prefs.meetingWindowMinutes, DEFAULT_MEETING_WINDOW_MINUTES),
    saveForLater: prefs.saveForLater !== false,
    resolvedEmojis: parseEmojis(prefs.resolvedEmojis),
    claudePath: resolvePath(prefs.claudePath, "~/.local/bin/claude"),
  };
}
