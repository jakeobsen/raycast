# Raycast Plugins

A monorepo of self-contained [Raycast](https://raycast.com) extensions. Each folder under `extensions/` is an independent, individually-buildable Raycast extension — lift one out of the repo and it still works standalone. A single top-level `Makefile` is the command surface for building them and installing them into Raycast.

## Prerequisites

- **macOS** with [Raycast.app](https://raycast.com) installed.
- **Node 22.14+** (Raycast's current minimum). Check with `node --version`. If yours is older: `brew install node` or `nvm install 22`.
- `make` (ships with macOS Command Line Tools).

No global Raycast CLI install is needed — `ray` is a dev dependency of each extension and is invoked through `npm run`.

## Quick start

```bash
make help                   # list targets and discovered extensions
make deps                   # npm install for every extension
make dev-hello-world        # register hello-world with Raycast + live reload
# → open Raycast, search for "Say Hello", hit Return to see the HUD

make dev-better-visual-studio-code-project-manager
# → open Raycast, search for "Search Project Manager"

make dev-scratch
# → open Raycast, search for "Create Scratch" or "Scratch Folders"

make dev-next-task
# → open Raycast, search for "Next Task"
```

Press Ctrl+C to stop the dev server.

## Makefile reference

| Target              | What it does                                                        |
|---------------------|---------------------------------------------------------------------|
| `make help`         | Show help (default target).                                         |
| `make list`         | List discovered extensions, one per line.                           |
| `make deps`         | `npm install` in every extension.                                   |
| `make deps-<name>`  | `npm install` in one extension.                                     |
| `make build`        | `ray build` in every extension.                                     |
| `make build-<name>` | `ray build` in one extension.                                       |
| `make dev-<name>`   | `ray develop` — installs into Raycast + live reload.                |
| `make lint`         | `ray lint` in every extension.                                      |
| `make lint-<name>`  | `ray lint` in one extension.                                        |
| `make clean`        | Remove `node_modules` and build artifacts from every extension.     |
| `make clean-<name>` | Clean one extension.                                                |

Parallel builds: `make -j build` builds every extension concurrently (per-extension targets are independent). The Makefile uses a sentinel file (`node_modules/.installed`) so `npm install` only runs when `package.json` has changed.

### Note on `make lint`

`ray lint` validates the `author` field in `package.json` against the Raycast Store user API. For personal/dev extensions whose author is not a registered Raycast Store user, this check fails even with `--relaxed`. ESLint and Prettier still run; only the author check errors. Build (`make build`) and dev (`make dev-<name>`) are unaffected. To silence it, set `author` in each extension's `package.json` to a valid Raycast Store username, or simply skip `make lint` for non-publish workflows.

## Adding a new extension

Raycast's scaffolding is GUI-driven — there is no `npm init raycast-extension`. The flow:

1. Open Raycast → run the **Create Extension** command.
2. Fill in name, title, description, and pick a template.
3. Save the generated folder to any location.
4. **Move the folder into `extensions/`** in this repo.
5. `make dev-<new-name>` to install it into Raycast and start developing.

Alternatively, copy `extensions/hello-world/` to `extensions/<new-name>/` and edit `package.json` — rename `name`, `title`, and update `commands`.

## Extensions in this repo

- **[hello-world](extensions/hello-world/)** — minimal seed used as a template for new extensions.
- **[better-visual-studio-code-project-manager](extensions/better-visual-studio-code-project-manager/)** — fork of the official Raycast [`visual-studio-code-project-manager`](https://github.com/raycast/extensions/tree/main/extensions/visual-studio-code-project-manager) extension. Same feature set, plus:
  - **Open in lazygit** (or any TUI git client) inside Terminal.app — replaces the upstream GUI git-client action.
  - **Open Git Remote in Browser** — opens the repo's `origin` on GitHub/GitLab/etc.
- **[scratch](extensions/scratch/)** — disposable working folders.
  - **Create Scratch** — makes `~/scratch/<random-name>` (optionally prefixed with a label you type) and opens it in VS Code.
  - **Scratch Folders** — browses them in active/stale sections (staleness = newest mtime anywhere inside), with the same shortcuts as the VS Code extension above (`⌘T` terminal, `⌘G` lazygit, `⌘⇧G` git remote, `⌘F` Finder, `⌘O` open with, `⌘.`/`⌘⇧.` copy) plus `⌘N` new folder, `⌃X` remove, and `⌘⇧X` to trash everything untouched for 7+ days.
- **[next-task](extensions/next-task/)** — asks Claude Code (headless, read-only) what to work on next from your calendar, Jira board, Slack and Gmail. Defaults to Opus 5.5; runs keep going if you close Raycast.

## "Install into Raycast" — what's happening

Raycast has no standalone `install` CLI and no `raycast://` deep link for programmatic local import. The Makefile uses `ray develop` (`make dev-<name>`) to both register an extension with Raycast and watch for changes. While the dev server runs, the extension and its commands are available in Raycast. Stop it with Ctrl+C. For a production compile (no dev server), run `make build-<name>`.

## Layout

```
.
├── Makefile
├── README.md
├── .gitignore
└── extensions/
    ├── hello-world/                                   example extension — deletable
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── src/say-hello.ts
    │   ├── assets/extension-icon.png
    │   ├── README.md
    │   └── CHANGELOG.md
    ├── better-visual-studio-code-project-manager/     fork of the upstream Raycast extension with lazygit + git-remote-in-browser actions
    ├── scratch/                                       disposable ~/scratch folders + stale-folder cleanup
    └── next-task/                                     asks Claude Code what to work on next
```

No root `package.json`, no npm/pnpm/yarn workspaces. Each extension has its own `node_modules`. This is intentional — every extension stays self-contained and portable.
