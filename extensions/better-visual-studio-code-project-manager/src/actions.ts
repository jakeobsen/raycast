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

type TerminalKind = "terminal-app" | "kitty" | "iterm2" | "unknown";

function detectTerminal(appPath: string | undefined): TerminalKind {
  const p = (appPath ?? "").toLowerCase();
  if (p.endsWith("/terminal.app")) return "terminal-app";
  if (p.endsWith("/kitty.app")) return "kitty";
  if (p.endsWith("/iterm.app")) return "iterm2";
  return "unknown";
}

function run(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(file, args, env ? { env } : {}, (err) => (err ? reject(err) : resolve())),
  );
}

/** Raycast inherits macOS's modern ICU LC_ALL string (e.g. en_US@rg=dkzzzz-u-hc-…) which
 * bash/zsh can't parse. Override with a clean UTF-8 locale when spawning terminals. */
function cleanEnv(): NodeJS.ProcessEnv {
  return { ...process.env, LC_ALL: "en_US.UTF-8", LANG: process.env.LANG || "en_US.UTF-8" };
}

function userShell(): string {
  return process.env.SHELL || "/bin/zsh";
}

/** Launch the git TUI (lazygit etc.) inside the configured terminal at the project root. */
export async function openInGitClient(
  rootPath: string,
  gitClientCmd: string,
  terminalAppPath: string | undefined,
): Promise<void> {
  const kind = detectTerminal(terminalAppPath);

  switch (kind) {
    case "terminal-app": {
      const shellCmd = `cd ${shellQuote(rootPath)} && ${gitClientCmd}`;
      const script = `tell application "Terminal"
activate
do script ${applescriptQuote(shellCmd)}
end tell`;
      await run("/usr/bin/osascript", ["-e", script]);
      return;
    }

    case "kitty": {
      // --single-instance + --instance-group pins Raycast-launched windows to a dedicated
      // kitty process, separate from the user's main kitty — so it can be configured to quit
      // when its last window closes without affecting the main instance.
      // -o macos_quit_when_last_window_closed=yes applies only to this instance.
      // cleanEnv() strips macOS's broken LC_ALL so zsh rc files don't spew locale warnings.
      const kittyBin = `${terminalAppPath}/Contents/MacOS/kitty`;
      await run(
        kittyBin,
        [
          "--single-instance",
          "--instance-group=raycast-better-vscode-pm",
          "-o",
          "macos_quit_when_last_window_closed=yes",
          "--directory",
          rootPath,
          userShell(),
          "-lic",
          gitClientCmd,
        ],
        cleanEnv(),
      );
      return;
    }

    case "iterm2": {
      // iTerm2 exposes the same AppleScript surface as Terminal.app via `create window`.
      const shellCmd = `cd ${shellQuote(rootPath)} && ${gitClientCmd}`;
      const script = `tell application "iTerm"
activate
create window with default profile command ${applescriptQuote(shellCmd)}
end tell`;
      await run("/usr/bin/osascript", ["-e", script]);
      return;
    }

    default:
      await showToast({
        style: Toast.Style.Failure,
        title: "Unsupported terminal",
        message: `No launcher for ${terminalAppPath ?? "(unset)"}. Supported: Terminal.app, kitty, iTerm2.`,
      });
      if (terminalAppPath) {
        await run("/usr/bin/open", ["-a", terminalAppPath, rootPath]);
      }
      return;
  }
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
