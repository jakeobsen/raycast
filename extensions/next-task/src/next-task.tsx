import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatAge, formatElapsed, formatStartsIn, formatTimeRange, isLink } from "./lib/format";
import { EditWorkflow } from "./edit-workflow";
import { getPreferences } from "./lib/prefs";
import { renderWorkflow, type Meeting, type SavedStatus, type Task, type TaskSource } from "./lib/prompt";
import { loadError, loadResult, RunWatcher, startRun, stopRun, type RunProgress } from "./lib/run";
import { findSaved, letGo, loadSaved, type SavedItem } from "./lib/saved-store";
import { loadSavedWorkflow } from "./lib/workflow-store";
import { SaveForLater } from "./save-for-later";

/** The stream file is cheap to tail, and a second is fine-grained enough for a run that takes a minute. */
const POLL_MS = 1000;

/** Official app icons, bundled in assets/ so nothing is fetched (or leaked) at runtime. */
const BRAND_ICONS = {
  jira: "jira.png",
  slack: "slack.png",
  gmail: "gmail.png",
  calendar: "google-calendar.png",
} as const;

const SOURCE_ICONS: Record<TaskSource, string> = {
  jira: BRAND_ICONS.jira,
  bau: BRAND_ICONS.jira,
  slack: BRAND_ICONS.slack,
  email: BRAND_ICONS.gmail,
  calendar: BRAND_ICONS.calendar,
};

/** The icon of the app a link opens, so ↵ takes you where the icon says; undefined if we can't tell. */
function brandIconFor(url: string): string | undefined {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  if (host.endsWith(".atlassian.net")) return BRAND_ICONS.jira;
  if (host === "slack.com" || host.endsWith(".slack.com")) return BRAND_ICONS.slack;
  if (host === "mail.google.com") return BRAND_ICONS.gmail;
  if (host === "calendar.google.com") return BRAND_ICONS.calendar;
  return undefined;
}

/** Judged by the link first (a BAU item can be a Jira ticket or a Slack canvas), then the source. */
function iconFor(task: Task): string {
  return brandIconFor(task.url) ?? SOURCE_ICONS[task.source] ?? BRAND_ICONS.jira;
}

const SAVED_STATUS_TAGS: Record<SavedStatus["status"], { value: string; color: Color } | undefined> = {
  done: { value: "Looks done", color: Color.Green },
  waiting: { value: "Waiting", color: Color.Orange },
  open: undefined,
};

/** Keeps "in 9 min" honest while the list sits open between runs. */
const CLOCK_TICK_MS = 30_000;

type TimedMeeting = Meeting & { startMs: number; endMs: number };

/** Meetings with times we can read, soonest first. Answers saved before meetings existed have none. */
function timedMeetings(meetings: Meeting[] | undefined): TimedMeeting[] {
  return (meetings ?? [])
    .map((meeting) => ({ ...meeting, startMs: Date.parse(meeting.start), endMs: Date.parse(meeting.end) }))
    .filter((meeting) => Number.isFinite(meeting.startMs) && Number.isFinite(meeting.endMs))
    .sort((a, b) => a.startMs - b.startMs);
}

/** The meeting to show at the top: not over yet, and starting within the window (or already started). */
function soonMeeting(meetings: TimedMeeting[], nowMs: number, windowMinutes: number): TimedMeeting | undefined {
  return meetings.find((meeting) => meeting.endMs > nowMs && meeting.startMs - nowMs <= windowMinutes * 60_000);
}

function meetingDetails(meeting: TimedMeeting): string {
  return [
    meeting.title,
    formatTimeRange(meeting.startMs, meeting.endMs),
    meeting.url || meeting.location,
    meeting.attendees.length > 0 ? `With ${meeting.attendees.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export default function Command() {
  const prefs = useMemo(getPreferences, []);
  const [watcher] = useState(() => new RunWatcher());
  // Poll before loading the stored answer: a run that finished while Raycast was closed
  // gets recorded by this first poll, so the loads below already see it.
  const [progress, setProgress] = useState<RunProgress | undefined>(() => watcher.poll());
  const [result, setResult] = useState(loadResult);
  const [error, setError] = useState(loadError);
  const [now, setNow] = useState(Date.now);
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const running = progress !== undefined;

  const reloadSaved = useCallback(() => {
    loadSaved().then(setSaved);
  }, []);

  useEffect(reloadSaved, [reloadSaved]);

  const refresh = useCallback(() => {
    const next = watcher.poll();
    setProgress(next);
    if (!next) {
      setResult(loadResult());
      setError(loadError());
    }
    setNow(Date.now());
  }, [watcher]);

  const ask = useCallback(async () => {
    try {
      const workflow = renderWorkflow(await loadSavedWorkflow(), prefs, new Date());
      if (workflow.unknown.length > 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Unknown placeholders in workflow",
          message: `${workflow.unknown.join(", ")} sent to Claude as-is. Fix them with ⌘E.`,
        });
      }
      startRun(prefs, workflow, prefs.saveForLater ? await loadSaved() : []);
    } catch (startError) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not ask Claude",
        message: startError instanceof Error ? startError.message : String(startError),
      });
    }
    refresh();
  }, [prefs, refresh]);

  async function stop() {
    const confirmed = await confirmAlert({
      title: "Stop this run?",
      message: "Whatever Claude has read so far is thrown away.",
      icon: Icon.Stop,
      primaryAction: { title: "Stop", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    stopRun();
    refresh();
  }

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);

  // Between runs nothing polls, so tick the clock for meeting countdowns.
  useEffect(() => {
    if (running) return;
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [running]);

  // Opening the command is the request: ask straight away unless a recent answer is on hand
  // or a run is already going.
  useEffect(() => {
    if (running) return;
    const fresh = result && Date.now() - result.finishedAt < prefs.reuseMinutes * 60_000;
    if (!fresh) ask();
  }, []);

  function commonActions() {
    return (
      <ActionPanel.Section>
        {running ? (
          <Action title="Stop Run" icon={Icon.Stop} shortcut={{ modifiers: ["ctrl"], key: "x" }} onAction={stop} />
        ) : (
          <Action
            title="Ask Again"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={ask}
          />
        )}
        <Action.Push
          title="Edit Workflow"
          icon={Icon.Pencil}
          shortcut={Keyboard.Shortcut.Common.Edit}
          target={<EditWorkflow prefs={prefs} />}
        />
      </ActionPanel.Section>
    );
  }

  async function letGoOf(item: SavedItem) {
    await letGo(item.id);
    reloadSaved();
    await showToast({ style: Toast.Style.Success, title: "Let go", message: item.title });
  }

  /** Save for Later, or Let Go if it's already saved. Nothing at all while the feature is off. */
  function saveActions(title: string, url: string) {
    if (!prefs.saveForLater) return null;
    const existing = findSaved(saved, url, title);
    return (
      <ActionPanel.Section>
        {existing ? (
          <Action
            title="Let Go"
            icon={Icon.XMarkCircle}
            shortcut={{ modifiers: ["cmd"], key: "backspace" }}
            onAction={() => letGoOf(existing)}
          />
        ) : (
          <Action.Push
            title="Save for Later…"
            icon={Icon.Bookmark}
            shortcut={Keyboard.Shortcut.Common.Save}
            target={<SaveForLater title={title} url={url} onSaved={reloadSaved} />}
          />
        )}
      </ActionPanel.Section>
    );
  }

  function savedItem(item: SavedItem, status: SavedStatus | undefined) {
    const tag = status ? SAVED_STATUS_TAGS[status.status] : undefined;
    return (
      <List.Item
        key={item.id}
        icon={brandIconFor(item.url) ?? Icon.Bookmark}
        title={item.title}
        accessories={tag ? [{ tag }] : []}
        detail={
          <List.Item.Detail
            markdown={[`## ${item.title}`, status?.note, `Saved ${formatAge(item.savedAt, now)}.`]
              .filter(Boolean)
              .join("\n\n")}
          />
        }
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              {isLink(item.url) && <Action.OpenInBrowser url={item.url} />}
              <Action
                title="Let Go"
                icon={Icon.XMarkCircle}
                shortcut={{ modifiers: ["cmd"], key: "backspace" }}
                onAction={() => letGoOf(item)}
              />
              <Action.Push
                title="Rename…"
                icon={Icon.Pencil}
                target={<SaveForLater title={item.title} url={item.url} onSaved={reloadSaved} />}
              />
            </ActionPanel.Section>
            {commonActions()}
          </ActionPanel>
        }
      />
    );
  }

  function meetingItem(meeting: TimedMeeting) {
    const virtual = isLink(meeting.url);
    const when = `${formatTimeRange(meeting.startMs, meeting.endMs)} · ${formatStartsIn(meeting.startMs, now)}`;
    return (
      <List.Item
        icon={BRAND_ICONS.calendar}
        title={meeting.title}
        subtitle={when}
        detail={
          <List.Item.Detail
            markdown={[
              `## ${meeting.title}`,
              `**${when}**`,
              virtual ? "Video call. Press ↵ to join." : "",
              meeting.location ? `At ${meeting.location}.` : virtual ? "" : "No location given.",
              meeting.attendees.length > 0 ? `With ${meeting.attendees.join(", ")}.` : "",
              meeting.notes,
            ]
              .filter(Boolean)
              .join("\n\n")}
          />
        }
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              {virtual && <Action.OpenInBrowser title="Join Meeting" icon={Icon.Video} url={meeting.url} />}
              {virtual && (
                <Action.CopyToClipboard
                  title="Copy Meeting Link"
                  content={meeting.url}
                  shortcut={Keyboard.Shortcut.Common.Pin}
                />
              )}
              <Action.CopyToClipboard
                title="Copy Meeting Details"
                content={meetingDetails(meeting)}
                shortcut={{ modifiers: ["cmd", "shift"], key: "." }}
              />
            </ActionPanel.Section>
            {commonActions()}
          </ActionPanel>
        }
      />
    );
  }

  /** A task's detail is just the task: what and why. The icon shows the source; ↵ opens the link. */
  function taskItem(task: Task, key: string) {
    const isSaved = prefs.saveForLater && !!findSaved(saved, task.url, task.title);
    return (
      <List.Item
        key={key}
        icon={iconFor(task)}
        title={task.title}
        accessories={isSaved ? [{ icon: Icon.Bookmark, tooltip: "Saved for later" }] : []}
        detail={<List.Item.Detail markdown={`## ${task.title}\n\n${task.why}`} />}
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              {isLink(task.url) && <Action.OpenInBrowser url={task.url} />}
              <Action.CopyToClipboard title="Copy Link" content={task.url} shortcut={Keyboard.Shortcut.Common.Pin} />
              <Action.CopyToClipboard
                title="Copy Task"
                content={`${task.title}\n${task.why}\n${task.url}`}
                shortcut={{ modifiers: ["cmd", "shift"], key: "." }}
              />
            </ActionPanel.Section>
            {saveActions(task.title, isLink(task.url) ? task.url : "")}
            {commonActions()}
          </ActionPanel>
        }
      />
    );
  }

  const answer = result?.answer;
  const unreadable = result?.unreadable ?? [];
  // A result too large for the model means the answer was made from a partial picture; say so.
  const unreadableNote =
    unreadable.length > 0
      ? `Claude couldn't read ${unreadable.length === 1 ? "one result" : `${unreadable.length} results`} because ${unreadable.length === 1 ? "it was" : "they were"} too large (${[...new Set(unreadable)].join(", ")}), so this answer may have missed something. Ask again with ⌘R.`
      : undefined;
  const meetings = timedMeetings(answer?.upcomingMeetings);
  // Judge against the real clock, not the last tick, so a meeting is gone the moment it ends.
  const meeting = soonMeeting(meetings, Date.now(), prefs.meetingWindowMinutes);
  // Saved items are yours, not part of an answer, so they show even before the first answer.
  const showSaved = prefs.saveForLater && saved.length > 0;
  const savedStatusFor = (item: SavedItem) => answer?.savedStatus?.find((entry) => entry.id === item.id);

  return (
    <List
      isLoading={running}
      isShowingDetail={running || !!error || !!answer || showSaved}
      navigationTitle="Next Task"
      searchBarPlaceholder="Filter tasks and notes"
    >
      {progress && (
        <List.Section title="Asking Claude">
          <List.Item
            icon={Icon.CircleProgress}
            title={progress.label}
            subtitle={`${progress.steps} step${progress.steps === 1 ? "" : "s"} · ${formatElapsed(now - progress.startedAt)}`}
            detail={
              <List.Item.Detail
                markdown={[
                  "Claude is reading your calendar, Jira, Slack and Gmail with read-only tools.",
                  "You can close Raycast. The run keeps going, and the answer will be here next time you open **Next Task**.",
                  progress.workflow === "example"
                    ? "No workflow saved yet, so this run uses the built-in example. Press **⌘E** to set your own."
                    : "",
                  progress.unknownPlaceholders.length > 0
                    ? `Your workflow has unknown placeholders, sent to Claude as-is: ${progress.unknownPlaceholders.join(", ")}. Fix them with **⌘E**.`
                    : "",
                ]
                  .filter(Boolean)
                  .join("\n\n")}
              />
            }
            actions={<ActionPanel>{commonActions()}</ActionPanel>}
          />
        </List.Section>
      )}

      {error && !running && (
        <List.Section title="Last Run Failed">
          <List.Item
            icon={{ source: Icon.Warning, tintColor: Color.Red }}
            title={error.message}
            subtitle={formatAge(error.at, now)}
            detail={<List.Item.Detail markdown={"```\n" + error.message + "\n```"} />}
            actions={
              <ActionPanel>
                {commonActions()}
                <Action.CopyToClipboard title="Copy Error" content={error.message} />
              </ActionPanel>
            }
          />
        </List.Section>
      )}

      {result && answer && (
        <>
          {meeting && (
            <List.Section title="Meeting" subtitle={formatStartsIn(meeting.startMs, now)}>
              {meetingItem(meeting)}
            </List.Section>
          )}
          <List.Section title="Next">{taskItem(answer.next, "next")}</List.Section>
          {answer.alternatives.length > 0 && (
            <List.Section title="Alternatives">
              {answer.alternatives.map((task, index) => taskItem(task, `alternative-${index}`))}
            </List.Section>
          )}
          {(answer.flags.length > 0 || unreadableNote) && (
            <List.Section title="Notes">
              {unreadableNote && (
                <List.Item
                  icon={{ source: Icon.Warning, tintColor: Color.Orange }}
                  title={unreadableNote}
                  detail={<List.Item.Detail markdown={unreadableNote} />}
                  actions={<ActionPanel>{commonActions()}</ActionPanel>}
                />
              )}
              {answer.flags.map((flag, index) => (
                <List.Item
                  key={`flag-${index}`}
                  icon={{ source: Icon.Flag, tintColor: Color.Yellow }}
                  title={flag}
                  detail={<List.Item.Detail markdown={flag} />}
                  actions={
                    <ActionPanel>
                      <ActionPanel.Section>
                        <Action.CopyToClipboard title="Copy Note" content={flag} />
                      </ActionPanel.Section>
                      {saveActions(flag, "")}
                      {commonActions()}
                    </ActionPanel>
                  }
                />
              ))}
            </List.Section>
          )}
        </>
      )}

      {showSaved && (
        <List.Section title="Saved for Later">
          {saved.map((item) => savedItem(item, savedStatusFor(item)))}
        </List.Section>
      )}

      <List.EmptyView
        icon={Icon.Stars}
        title="No answer yet"
        description="Press ⌘R to ask Claude what to work on next."
        actions={<ActionPanel>{commonActions()}</ActionPanel>}
      />
    </List>
  );
}
