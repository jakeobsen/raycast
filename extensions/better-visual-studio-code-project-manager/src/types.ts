export type ProjectEntry = {
  name: string;
  rootPath: string;
  paths?: string[];
  tags: string[];
  enabled: boolean;
  /** used as frecency key */
  id: string;
};

export type CachedProjectEntry = {
  name: string;
  fullPath: string;
};

export type Preferences = {
  groupProjectsByTag: boolean;
  hideProjectsWithoutTag: boolean;
  hideProjectsNotEnabled: boolean;
  vscodeApp?: { name: string; path: string; bundleId?: string };
  projectManagerDataPath?: string;
  terminalApp?: { name: string; path: string; bundleId?: string };
  gitClientApp: string;
};
