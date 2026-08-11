import { getPreferenceValues } from "@raycast/api";
import { homedir } from "os";
import { join, isAbsolute, normalize } from "path";

export type NameStyle = "words" | "words-suffix" | "date-words" | "hex";
export type DeleteMode = "trash" | "permanent";

export type AppPreference = { name: string; path: string; bundleId?: string };

type RawPreferences = {
  scratchRoot?: string;
  editorApp?: AppPreference;
  openInEditor: boolean;
  staleDays?: string;
  nameStyle?: NameStyle;
  deleteMode?: DeleteMode;
  terminalApp?: AppPreference;
  gitClientApp?: string;
};

export type ScratchPreferences = {
  scratchRoot: string;
  editorApp?: AppPreference;
  openInEditor: boolean;
  staleDays: number;
  nameStyle: NameStyle;
  deleteMode: DeleteMode;
  terminalApp?: AppPreference;
  gitClientApp: string;
};

export const DEFAULT_STALE_DAYS = 7;

/** Expand a leading ~ and resolve to an absolute path; relative input is taken from $HOME. */
function resolveRoot(input: string | undefined): string {
  const raw = (input ?? "").trim();
  if (!raw) return join(homedir(), "scratch");
  if (raw === "~") return homedir();
  if (raw.startsWith("~/")) return normalize(join(homedir(), raw.slice(2)));
  if (isAbsolute(raw)) return normalize(raw);
  return normalize(join(homedir(), raw));
}

export function getPreferences(): ScratchPreferences {
  const prefs = getPreferenceValues<RawPreferences>();
  const parsedDays = Number.parseFloat((prefs.staleDays ?? "").trim());
  return {
    scratchRoot: resolveRoot(prefs.scratchRoot),
    editorApp: prefs.editorApp,
    openInEditor: prefs.openInEditor !== false,
    // Guard against a blank/garbage/negative preference value — a 0-day threshold would
    // make every folder stale, which is exactly the mistake you cannot undo.
    staleDays: Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : DEFAULT_STALE_DAYS,
    nameStyle: prefs.nameStyle ?? "words",
    deleteMode: prefs.deleteMode ?? "trash",
    terminalApp: prefs.terminalApp,
    gitClientApp: prefs.gitClientApp?.trim() || "lazygit",
  };
}
