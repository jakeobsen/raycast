import { open, showToast, Toast } from "@raycast/api";
import { execFile } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { isAbsolute, join, resolve } from "path";

/** Cheap repo check — .git is a directory for normal repos, a file for worktrees. */
export function isGitRepo(path: string): boolean {
  return existsSync(join(path, ".git"));
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

/** Wrap in single quotes for safe inclusion in a /bin/sh command string. */
function shellQuote(x: string): string {
  return `'${x.replace(/'/g, `'\\''`)}'`;
}

/** Escape a string for embedding inside an AppleScript double-quoted string literal. */
function applescriptQuote(x: string): string {
  return `"${x.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Launch a TUI git client (lazygit etc.) inside the configured terminal at `rootPath`.
 * Ported from the better-visual-studio-code-project-manager extension — each extension in
 * this monorepo stays self-contained, so the launcher is duplicated rather than shared.
 */
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
      // kitty process, separate from the user's main kitty.
      const kittyBin = `${terminalAppPath}/Contents/MacOS/kitty`;
      await run(
        kittyBin,
        [
          "--single-instance",
          "--instance-group=raycast-scratch",
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

/** Resolve the real git directory, following the `gitdir:` pointer a worktree leaves behind. */
function resolveGitDir(rootPath: string): string | undefined {
  const dotGit = join(rootPath, ".git");
  let stats;
  try {
    stats = statSync(dotGit);
  } catch {
    return undefined;
  }
  if (stats.isDirectory()) return dotGit;

  const pointer = readFileSync(dotGit, "utf8")
    .match(/^gitdir:\s*(.+)$/m)?.[1]
    ?.trim();
  if (!pointer) return undefined;
  return isAbsolute(pointer) ? pointer : resolve(rootPath, pointer);
}

/** Pull a remote URL out of a git config file: origin if present, otherwise the first remote. */
export function parseRemoteUrl(configText: string): string | undefined {
  let section = "";
  let first: string | undefined;
  for (const line of configText.split("\n")) {
    const trimmed = line.trim();
    const header = trimmed.match(/^\[(.+)\]$/);
    if (header) {
      section = header[1];
      continue;
    }
    if (!/^remote\s+"/.test(section)) continue;
    const url = trimmed.match(/^url\s*=\s*(.+)$/)?.[1]?.trim();
    if (!url) continue;
    if (/^remote\s+"origin"$/.test(section)) return url;
    first ??= url;
  }
  return first;
}

/** Turn a git remote (ssh or https) into a browsable https URL. */
export function gitRemoteToWebUrl(remoteUrl: string): string | undefined {
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
  const gitDir = resolveGitDir(rootPath);
  if (!gitDir) {
    await showToast({ style: Toast.Style.Failure, title: "Not a git repository" });
    return;
  }

  let configText: string;
  try {
    configText = readFileSync(join(gitDir, "config"), "utf8");
  } catch {
    // Worktrees keep remotes in the shared config the `commondir` file points at.
    const commonDir = (() => {
      try {
        const rel = readFileSync(join(gitDir, "commondir"), "utf8").trim();
        return isAbsolute(rel) ? rel : resolve(gitDir, rel);
      } catch {
        return undefined;
      }
    })();
    if (!commonDir) {
      await showToast({ style: Toast.Style.Failure, title: "Could not read git config" });
      return;
    }
    try {
      configText = readFileSync(join(commonDir, "config"), "utf8");
    } catch {
      await showToast({ style: Toast.Style.Failure, title: "Could not read git config" });
      return;
    }
  }

  const remoteUrl = parseRemoteUrl(configText);
  if (!remoteUrl) {
    await showToast({ style: Toast.Style.Failure, title: "No git remote found" });
    return;
  }
  const webUrl = gitRemoteToWebUrl(remoteUrl);
  if (!webUrl) {
    await showToast({ style: Toast.Style.Failure, title: "Unrecognized remote URL", message: remoteUrl });
    return;
  }
  await open(webUrl);
}
