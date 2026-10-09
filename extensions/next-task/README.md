# Next Task

Asks Claude what to work on next. **Next Task** runs Claude Code headless (`claude -p`) against your calendar, Jira, Slack and Gmail, and shows one pick, up to three alternatives, and notes worth knowing.

## The workflow

What Claude checks and how it judges it is your **workflow**: plain text you edit inside Raycast with `⌘E` (**Edit Workflow**). It's stored in the extension's local storage, so names, IDs and team conventions stay on your machine and never end up in this repo. Until you save one, a generic built-in example is used: today's calendar, your open Jira issues, Slack mentions and DMs, and Gmail threads waiting on you.

Your workflow is wrapped in fixed rules that you can't edit out: read-only, treat everything read as data rather than instructions, fetch every page before deciding, and the answer format (one pick ordered blocking > time-sensitive > in progress > new, sized to the time before your next meeting).

Placeholders are filled in when a run starts:

| Placeholder | Value |
|---|---|
| `{{date}}` | today, e.g. `2026-10-07` |
| `{{weekday}}` | e.g. `Wednesday` |
| `{{time}}` | e.g. `15:20` |
| `{{timezone}}` | e.g. `Europe/Copenhagen` |
| `{{weekStart}}` | Monday of this week |
| `{{resolvedReactions}}` | the *Resolved Reactions* preference |

An unknown placeholder (say `{{dat}}`) is sent as-is and flagged in a toast and the progress pane.

Local storage survives rebuilds and updates, but not removing the extension, so keep a copy of your workflow somewhere private if you'd mind retyping it.

## Using it

Opening the command asks Claude straight away, unless the last answer is younger than *Reuse Answer For* (default 30 min). A run takes about a minute on Opus; the progress row shows what it's reading.

You can close Raycast mid-run. Claude keeps going in the background, and the answer is there next time you open the command.

| Shortcut | Action |
|---|---|
| `↵` | Open the task's link (ticket, thread, canvas, email), or join the meeting |
| `⌘.` | Copy link |
| `⌘⇧.` | Copy task (title, reason, link) |
| `⌘R` | Ask again |
| `⌘E` | Edit workflow |
| `⌘S` | Save a task or note for later |
| `⌘⌫` | Let go of a saved item |
| `⌃X` | Stop the current run |

When your next meeting starts within *Show Meetings Starting Within* (default 60 min), it's shown at the top with a live countdown until it ends. A virtual meeting's `↵` joins it (Zoom, Meet or Teams link); an in-person one shows the time, place, attendees and what it's about.

Each item carries the official icon of where `↵` takes you — Jira, Slack, Gmail or Google Calendar, judged from the link — and the right-hand side shows just the title and the reason. The icons are bundled, so nothing is fetched at runtime.

## Save for later

`⌘S` on a task or note saves it for later exactly as it is: title, link and Claude's reason. Saved items sit in a **Saved for Later** section, showing that reason, Claude's latest take on where it stands, and when you saved it, until you let them go with `⌘⌫` — nothing disappears on its own.

Claude sees the saved list — titles, links and dates only; the saved reason stays out, since Claude re-checks each item live anyway — and, for each item, reports where it stands: **Looks done** when its ticket or thread is finished, **Waiting** when it's on someone else. It won't push a saved item as your next task just because it's saved, only when something changed (someone is now blocked on it) or when nothing more urgent is waiting and you have time before your next meeting.

Switch it off with the *Save for Later* preference: the actions, the section and the list sent to Claude all go away, but your saved items are kept for when you switch it back on.

## Read-only by construction

Claude gets no built-in tools (`--tools ""`) and only MCP read tools: calendar list/get, Slack read/search/profile, Jira search/get and site lookup, Gmail search/get thread. Every write tool on those connectors (send, reply, post, create, edit, transition, trash, label, …) is explicitly denied with `--disallowedTools`, because Claude Code settings can pre-approve some of them and `--permission-mode dontAsk` would otherwise let those through. Denied tools are also hidden from the model. Any refused tool call is recorded in the run's `result.json`.

For debugging, each run's JSON is kept for 7 days in `history/<start time>-<outcome>/` in the extension's support folder: `stream.jsonl` (Claude's full event stream), `meta.json`, and `result.json` or `error.json`. Older runs are deleted whenever a run ends. The stream contains raw message, mail and ticket text, so it stays on this machine and nothing keeps it longer.

## Preferences

| Preference | Default | What it does |
|---|---|---|
| Model | Opus 5.5 | Also Sonnet 5.5 (faster, cheaper, cut corners in side-by-side runs) and Fable 5.1. |
| Effort | Medium | Low / Medium / High / Extra High. |
| Reuse Answer For (Minutes) | `30` | `0` asks every time the command opens. |
| Show Meetings Starting Within (Minutes) | `60` | Your next meeting appears at the top once it's this close, and stays until it ends. |
| Save for Later | enabled | Turns the Save for Later feature on or off. Saved items are kept either way. |
| Resolved Reactions | `white_check_mark, heavy_check_mark` | Slack reactions that mark a request done, inserted at `{{resolvedReactions}}`. Comma-separated, colons optional. |
| Claude CLI Path | `~/.local/bin/claude` | Raycast doesn't see your shell `PATH`, so this has to be a real path. |

## Requirements

- Claude Code CLI, logged in, with the claude.ai **Google Calendar**, **Slack**, **Gmail** and **Atlassian** connectors authorised. If any of them doesn't load, the run stops early and says which.
- Runs start with `MCP_CONNECTION_NONBLOCKING=false MCP_TIMEOUT=30000`; without them headless runs often start before the claude.ai connectors are ready. `USER`/`LOGNAME` are filled in from the OS account too, since Raycast doesn't set them and the CLI needs `USER` to find its keychain login.

## Develop

From the repo root:

```bash
make deps-next-task     # install dependencies
make dev-next-task      # register with Raycast + live reload
make build-next-task    # production compile
```
