# Better Visual Studio Code - Project Manager

A fork of the official Raycast [`visual-studio-code-project-manager`](https://github.com/raycast/extensions/tree/main/extensions/visual-studio-code-project-manager) extension. 1:1 feature parity with upstream, plus two additions:

- **Open in lazygit** (or any TUI git client) — launched inside Terminal.app at the project root. Replaces the upstream GUI git-client action (Fork, Tower, etc.).
- **Open Git Remote in Browser** — parses the repo's `origin` remote and opens the corresponding GitHub/GitLab/etc. URL.

Reads a `projects.json` in the [VSCode Project Manager](https://marketplace.visualstudio.com/items?itemName=alefragnani.project-manager) schema (either from its default storage location, or from any directory you point at).

## Commands

- **Search Project Manager** — fuzzy search, tag filter, frecency-ranked list of all saved projects.

## Per-project actions

| Action | Shortcut |
|---|---|
| Open in VSCode (or `vscode-remote://` variant) | `↵` |
| Open in Terminal | `⌘T` |
| Open in \<git client\> *(lazygit by default)* | `⌘G` |
| Open Git Remote in Browser | `⌘⇧G` |
| Show in Finder | `⌘F` |
| Open With… | `⌘O` |
| Copy Name | `⌘.` |
| Copy Path | `⌘⇧.` |
| Reset Project Ranking | — |
| Move to Trash | `⌃X` |

## Preferences

- **Projects Location** — directory containing `projects.json`. Leave blank to use VSCode Project Manager's default storage directory (`~/Library/Application Support/Code/User/globalStorage/alefragnani.project-manager`). Also merges `projects_cache_{git,any,vscode}.json` when present.
- **VSCode** — which VSCode build to launch.
- **Terminal App Path** — terminal launched by "Open in Terminal". The lazygit launcher currently assumes Terminal.app; if another terminal is configured it falls back to just opening the folder.
- **Git Client Command** — shell command run inside Terminal.app for the git-client action. Defaults to `lazygit`; works with any TUI git client (`gitui`, `tig`, …).
- **Group Projects by tag** / **Hide Projects without tag** / **Hide Projects not enabled** — mirror the upstream preferences.

## Dev

From the monorepo root:

```sh
make dev-better-visual-studio-code-project-manager      # ray develop — registers with Raycast, hot reloads
make build-better-visual-studio-code-project-manager    # ray build
make lint-better-visual-studio-code-project-manager     # ray lint --relaxed (will 404 on author check — see root CLAUDE.md)
```

## Credit

All upstream design, UI structure, frecency/search, and VSCode-launching logic come from the [Raycast `visual-studio-code-project-manager` extension](https://github.com/raycast/extensions/tree/main/extensions/visual-studio-code-project-manager) by MarkusLanger and contributors. MIT licensed.
