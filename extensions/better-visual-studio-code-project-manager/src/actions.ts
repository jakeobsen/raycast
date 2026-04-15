import { open, showToast, Toast } from "@raycast/api";
import { execFile } from "child_process";
import { existsSync } from "fs";
import parseGitConfig from "parse-git-config";
import { applescriptQuote, shellQuote } from "./util";

const gitRepoCache = new Map<string, boolean>();

export function isGitRepo(path: string): boolean {
  const cached = gitRepoCache.get(path);
  if (cached !== undefined) return cached;
  // Cheap existence check — .git is a directory for normal repos, a file for worktrees;
  // either way it exists. Avoids a full INI parse per list item.
  const result = existsSync(`${path}/.git`);
  gitRepoCache.set(path, result);
  return result;
}

/** Launch the git TUI (lazygit etc.) inside Terminal.app at the project root. */
export async function openInGitClient(
  rootPath: string,
  gitClientCmd: string,
  terminalAppPath: string | undefined,
): Promise<void> {
  const isTerminalApp = (terminalAppPath ?? "").toLowerCase().endsWith("/terminal.app");
  if (!isTerminalApp) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Lazygit launcher requires Terminal.app",
      message: "Falling back to opening the folder in the configured terminal.",
    });
    if (terminalAppPath) {
      await new Promise<void>((resolve, reject) =>
        execFile("/usr/bin/open", ["-a", terminalAppPath, rootPath], (err) => (err ? reject(err) : resolve())),
      );
    }
    return;
  }

  const shellCmd = `cd ${shellQuote(rootPath)} && ${gitClientCmd}`;
  const script = `tell application "Terminal"
activate
do script ${applescriptQuote(shellCmd)}
end tell`;

  await new Promise<void>((resolve, reject) =>
    execFile("/usr/bin/osascript", ["-e", script], (err) => (err ? reject(err) : resolve())),
  );
}

type Remote = { url?: string };

function pickOrigin(remotes: Record<string, Remote>): string | undefined {
  if (remotes.origin?.url) return remotes.origin.url;
  for (const key of Object.keys(remotes)) {
    if (remotes[key]?.url) return remotes[key].url;
  }
  return undefined;
}

export function parseGitRemoteUrl(remoteUrl: string): string | undefined {
  // git@host:owner/repo(.git)?
  const sshMatch = remoteUrl.match(/^[\w.-]+@([A-Za-z0-9.-]+):(.+?)(\.git)?$/);
  if (sshMatch) {
    const [, host, pathPart] = sshMatch;
    return `https://${host}/${pathPart.replace(/\.git$/, "")}`;
  }
  // ssh://git@host[:port]/owner/repo(.git)?
  const sshUrlMatch = remoteUrl.match(/^ssh:\/\/[\w.-]+@([A-Za-z0-9.-]+)(?::\d+)?\/(.+?)(\.git)?$/);
  if (sshUrlMatch) {
    const [, host, pathPart] = sshUrlMatch;
    return `https://${host}/${pathPart.replace(/\.git$/, "")}`;
  }
  // https?://host/owner/repo(.git)?
  const httpMatch = remoteUrl.match(/^(https?):\/\/([^/]+)\/(.+?)(\.git)?$/);
  if (httpMatch) {
    const [, scheme, host, pathPart] = httpMatch;
    if (!/^[A-Za-z0-9.\-:]+$/.test(host)) return undefined;
    return `${scheme}://${host}/${pathPart.replace(/\.git$/, "")}`;
  }
  return undefined;
}

export async function openGitRemote(rootPath: string): Promise<void> {
  const gitConfigPath = `${rootPath}/.git/config`;
  if (!existsSync(gitConfigPath)) {
    await showToast({ style: Toast.Style.Failure, title: "Not a git repository" });
    return;
  }
  const cfg = parseGitConfig.sync({ cwd: rootPath, path: ".git/config" }) as Record<string, Remote>;
  const remotes: Record<string, Remote> = {};
  for (const [section, value] of Object.entries(cfg)) {
    const m = section.match(/^remote "(.+)"$/);
    if (m) remotes[m[1]] = value;
  }
  const remoteUrl = pickOrigin(remotes);
  if (!remoteUrl) {
    await showToast({ style: Toast.Style.Failure, title: "No git remote found" });
    return;
  }
  const webUrl = parseGitRemoteUrl(remoteUrl);
  if (!webUrl) {
    await showToast({ style: Toast.Style.Failure, title: "Unrecognized remote URL", message: remoteUrl });
    return;
  }
  await open(webUrl);
}
