import { existsSync, lstatSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname } from "path";
import { CachedProjectEntry, Preferences, ProjectEntry } from "./types";

export function getDefaultStoragePath(vscodeAppName: string | undefined): string {
  const short = (vscodeAppName ?? "Code").replace(/^Visual Studio /, "");
  return `${homedir()}/Library/Application Support/${short}/User/globalStorage/alefragnani.project-manager`;
}

export function getProjectsLocationPath(preferences: Preferences): { path: string; error?: string } {
  const configured = preferences.projectManagerDataPath;
  if (!configured) {
    return { path: getDefaultStoragePath(preferences.vscodeApp?.name) };
  }
  const resolved = configured.startsWith("~") ? homedir() + configured.slice(1) : configured;
  if (!existsSync(resolved)) {
    return { path: resolved, error: `Projects Location path does not exist: ${resolved}` };
  }
  const stat = lstatSync(resolved);
  if (stat.isDirectory()) return { path: resolved };
  if (stat.isFile()) return { path: dirname(resolved) };
  return { path: resolved, error: `Projects Location path is not a directory: ${resolved}` };
}

export function getProjectEntries(storagePath: string, preferences: Preferences): ProjectEntry[] {
  const savedProjectsFile = `${storagePath}/projects.json`;
  const cachedProjectsFiles = [
    `${storagePath}/projects_cache_git.json`,
    `${storagePath}/projects_cache_any.json`,
    `${storagePath}/projects_cache_vscode.json`,
  ];

  let projectEntries: ProjectEntry[] = [];

  if (existsSync(savedProjectsFile)) {
    const raw = JSON.parse(readFileSync(savedProjectsFile).toString()) as Partial<ProjectEntry>[];
    for (const entry of raw) {
      if (typeof entry?.name !== "string" || typeof entry?.rootPath !== "string") continue;
      projectEntries.push({
        id: entry.rootPath,
        name: entry.name,
        rootPath: entry.rootPath,
        paths: Array.isArray(entry.paths) ? entry.paths : [],
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        enabled: entry.enabled !== false,
      });
    }
  }

  for (const cachedFile of cachedProjectsFiles) {
    if (!existsSync(cachedFile)) continue;
    const cached = JSON.parse(readFileSync(cachedFile).toString()) as CachedProjectEntry[];
    for (const { name, fullPath } of cached) {
      if (projectEntries.find((p) => p.rootPath === fullPath)) continue;
      projectEntries.push({ id: fullPath, name, rootPath: fullPath, paths: [], tags: [], enabled: true });
    }
  }

  if (preferences.hideProjectsWithoutTag) {
    projectEntries = projectEntries.filter((p) => Array.isArray(p.tags) && p.tags.length > 0);
  }
  if (preferences.hideProjectsNotEnabled) {
    projectEntries = projectEntries.filter((p) => p.enabled);
  }

  return projectEntries;
}

export function getProjectTags(projectEntries: ProjectEntry[]): string[] {
  const tags = new Set<string>();
  for (const p of projectEntries) {
    for (const t of p.tags ?? []) tags.add(t);
  }
  return [...tags].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

export function filterProjectsByTag(projects: ProjectEntry[], selectedTag: string): ProjectEntry[] {
  if (!selectedTag) return projects;
  return projects.filter((p) => p.tags?.includes(selectedTag));
}

export function getProjectsGroupedByTag(projects: ProjectEntry[]): Map<string, ProjectEntry[]> {
  const grouped = new Map<string, ProjectEntry[]>();
  for (const project of projects) {
    const tags = project.tags?.length ? project.tags : ["[no tags]"];
    for (const tag of tags) {
      const bucket = grouped.get(tag) ?? [];
      bucket.push(project);
      grouped.set(tag, bucket);
    }
  }
  return new Map([...grouped.entries()].sort());
}
