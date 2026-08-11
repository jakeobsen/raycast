# Scratch Changelog

## [Initial Version] - 2026-08-11

- `Create Scratch` — creates a randomly named folder under the scratch root (default `~/scratch`), drops a `.scratch.json` marker in it, and opens it in the configured editor. Optional label argument is slugified into the folder name.
- `Scratch Folders` — browses scratch folders in **Active** (newest first) and **Stale** (oldest first) sections, classified by the newest mtime found anywhere inside each folder. Shortcuts mirror the better-visual-studio-code-project-manager extension: `↵` editor, `⌘T` terminal, `⌘G` git TUI, `⌘⇧G` git remote, `⌘F` Finder, `⌘O` open with, `⌘.`/`⌘⇧.` copy name/path, `⌘N` new scratch folder, `⌘R` refresh, `⌃X` remove, `⌘⇧X` clean up all stale.
- Removal (single or bulk) always confirms first and defaults to macOS Trash.
- Preferences: scratch root, editor, open-after-create, stale threshold in days, folder name style, terminal app, git client command, delete mode.
