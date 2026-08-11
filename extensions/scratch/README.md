# Scratch

Disposable working folders, on demand. **Create Scratch** makes a randomly named folder under `~/scratch` and opens it in VS Code; **Scratch Folders** browses what you have and cleans up whatever nothing has touched for a week.

## Commands

### Create Scratch

Creates `~/scratch/<random-name>` (e.g. `curious-walrus`), writes a small `.scratch.json` marker into it, and opens the folder in your editor.

Takes an optional **label** argument, which is slugified and prefixed to the random name — `Create Scratch` with `redis repro` gives `redis-repro-brave-otter`. Handy when you want to know later what the folder was for.

If the editor can't be launched, the folder is still created and its path is copied to the clipboard.

### Scratch Folders

Lists every folder directly under the scratch root, in two sections:

- **Active** — modified within the threshold, newest first (what you're most likely reaching for).
- **Stale** — nothing inside modified for at least *Stale After (Days)* (default 7), oldest first.

Staleness is decided by the newest mtime found **anywhere inside** the folder, not the folder's own mtime — editing a file three levels down keeps the whole scratch folder alive.

Shortcuts mirror the [better-visual-studio-code-project-manager](../better-visual-studio-code-project-manager/) extension so muscle memory carries over:

| Shortcut | Action |
|---|---|
| `↵` | Open in your editor (VS Code by default) |
| `⌘T` | Open in Terminal |
| `⌘G` | Open in `lazygit` (or whichever git TUI you configure) inside the terminal |
| `⌘⇧G` | Open the folder's git remote in the browser |
| `⌘F` | Show in Finder |
| `⌘O` | Open With… |
| `⌘.` | Copy folder name |
| `⌘⇧.` | Copy folder path |
| `⌘N` | Create a new scratch folder and open it |
| `⌘R` | Refresh the list |
| `⌃X` | Remove this folder |
| `⌘⇧X` | Clean up all stale folders |

`⌘G` and `⌘⇧G` report "Not a git repository" on folders that aren't one, so they're harmless on a plain scratch dir. Both delete actions ask for confirmation first, and default to macOS Trash so they stay recoverable.

Row accessories: a red age tag on stale rows, `large tree` on folders too big to scan, and a pin icon on folders that have no `.scratch.json` marker (i.e. you made them by hand rather than with **Create Scratch**).

## Preferences

| Preference | Default | What it does |
|---|---|---|
| Scratch Root | `~/scratch` | Directory that holds scratch folders. Created on first use. |
| Editor | Visual Studio Code | App opened by `↵` and after creating a folder. |
| After Creating… | open in editor | Uncheck to just create the folder and copy its path. |
| Stale After (Days) | `7` | Age threshold for the Stale section. Blank/invalid falls back to 7. |
| Folder Name Style | `brave-otter` | Also: `brave-otter-a1b2`, `2026-08-11-brave-otter`, `scratch-8f3a2c4d`. |
| Terminal App | Terminal.app | Terminal for `⌘T`, and the host for the git client. Terminal.app, kitty, and iTerm2 are supported. |
| Git Client Command | `lazygit` | Shell command `⌘G` runs at the folder root (e.g. `lazygit`, `gitui`, `tig`). |
| Delete Mode | Move to Trash | Or permanent delete (`rm -rf` semantics, not recoverable). |

## Safety rails

Cleanup is deliberately conservative, since the failure mode is deleted work:

- Only **direct child directories** of the scratch root are ever candidates — loose files and dotfolders are ignored, and every delete re-checks that the path is a direct child of the root before touching it.
- Symlinked directories are never followed while scanning, so a symlink can't drag the scan (or a delete) outside the scratch tree.
- Folders too large to scan fully (>20,000 entries, e.g. a fat `node_modules`) are marked `large tree` and never counted as stale.
- A missing or unparsable *Stale After (Days)* falls back to 7 rather than 0, so a bad preference can't mark everything stale.
- Nothing is deleted without a confirmation dialog.

## Develop

From the repo root:

```bash
make deps-scratch     # install dependencies
make dev-scratch      # register with Raycast + live reload
make build-scratch    # production compile
```
