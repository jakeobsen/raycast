import { LocalStorage } from "@raycast/api";

/**
 * The workflow lives in the extension's LocalStorage, edited through the Edit Workflow form,
 * so it stays on this machine and out of the repo. Raycast keeps LocalStorage across rebuilds
 * and updates of the extension; it's lost only if the extension is removed.
 */
const KEY = "workflow";

export async function loadSavedWorkflow(): Promise<string | undefined> {
  const saved = await LocalStorage.getItem<string>(KEY);
  return saved?.trim() ? saved : undefined;
}

export async function saveWorkflow(text: string): Promise<void> {
  if (text.trim()) await LocalStorage.setItem(KEY, text);
  else await LocalStorage.removeItem(KEY);
}
