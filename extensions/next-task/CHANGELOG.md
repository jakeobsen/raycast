# Next Task Changelog

## [Initial Version] - 2026-10-07

- `Next Task` — runs `claude -p` headless against calendar, Jira, Slack and Gmail and shows one pick, up to three alternatives and notes. Defaults to Opus 5.5 at medium effort.
- The workflow (what to check and how to judge it) is edited in Raycast with `⌘E` and kept in the extension's local storage, with placeholders for the date, time, week start and resolved reactions. A generic example is used until one is saved.
- Your next meeting is shown at the top when it starts within the configured window: `↵` joins a virtual one, an in-person one shows time, place, attendees and notes.
- Runs are detached from Raycast: closing the window doesn't stop them, and the answer is picked up on the next open. A progress row shows what Claude is reading.
- Each run's JSON (event stream, meta, outcome) is kept for 7 days in the support folder for debugging.
- Read-only: no built-in tools, an allowlist of MCP read tools, and an explicit deny list for every write tool on the connected servers.
- Stops early if the Calendar, Slack, Gmail or Atlassian connector didn't load, and stops runs still going after 10 minutes.
- Save for Later (toggleable): save tasks and notes with `⌘S`, keep them until you let go with `⌘⌫`. Claude checks where each stands ("Looks done", "Waiting") and suggests one only when something changed or nothing more urgent is waiting.
- Preferences: model, effort, how long to reuse an answer, meeting window, save for later, resolved reactions, path to the claude binary.
