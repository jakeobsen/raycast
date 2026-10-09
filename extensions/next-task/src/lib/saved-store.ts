import { LocalStorage } from "@raycast/api";
import { randomBytes } from "crypto";

/**
 * Things you chose to keep for later, kept until you let them go. They live in the extension's
 * LocalStorage alongside the workflow, and stay there when the feature is switched off, so
 * switching it back on brings them back.
 */
export type SavedItem = {
  /** Short random id; also how Claude refers to the item in its answer. */
  id: string;
  title: string;
  /** "" for things without a link, like a note. */
  url: string;
  savedAt: number;
};

const KEY = "savedForLater";

export async function loadSaved(): Promise<SavedItem[]> {
  try {
    const raw = await LocalStorage.getItem<string>(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function store(items: SavedItem[]): Promise<void> {
  await LocalStorage.setItem(KEY, JSON.stringify(items));
}

/** The saved entry for a link (or, for link-less things, an identical title), if there is one. */
export function findSaved(items: SavedItem[], url: string, title: string): SavedItem | undefined {
  return items.find((item) => (url ? item.url === url : !item.url && item.title === title));
}

/** Save something; saving the same link (or link-less title) again just renames it. */
export async function saveForLater(title: string, url: string): Promise<void> {
  const items = await loadSaved();
  const existing = findSaved(items, url, title);
  if (existing) {
    existing.title = title;
  } else {
    items.push({ id: randomBytes(4).toString("hex"), title, url, savedAt: Date.now() });
  }
  await store(items);
}

export async function letGo(id: string): Promise<void> {
  await store((await loadSaved()).filter((item) => item.id !== id));
}
