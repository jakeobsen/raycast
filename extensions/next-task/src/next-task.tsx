import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatAge, formatElapsed, formatStartsIn, formatTimeRange, isLink } from "./lib/format";
import { EditWorkflow } from "./edit-workflow";
import { getPreferences } from "./lib/prefs";
import { renderWorkflow, type Meeting, type Task, type TaskSource } from "./lib/prompt";
import { loadError, loadResult, RunWatcher, startRun, stopRun, type RunProgress } from "./lib/run";
import { loadSavedWorkflow } from "./lib/workflow-store";

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

/**
 * The icon of the app the link opens, so ↵ takes you where the icon says. Judged by the link
 * first: a BAU item can be a Jira ticket or a Slack canvas. The source is the fallback.
 */
function iconFor(task: Task): string {
  let host = "";
  try {
    host = new URL(task.url).hostname;
  } catch {
    // Not a URL — fall back to the source.
  }
  if (host.endsWith(".atlassian.net")) return BRAND_ICONS.jira;
  if (host === "slack.com" || host.endsWith(".slack.com")) return BRAND_ICONS.slack;
  if (host === "mail.google.com") return BRAND_ICONS.gmail;
  if (host === "calendar.google.com") return BRAND_ICONS.calendar;
  return SOURCE_ICONS[task.source] ?? BRAND_ICONS.jira;
}

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
  const running = progress !== undefined;

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
      startRun(prefs, workflow);
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
    return (
      <List.Item
        key={key}
        icon={iconFor(task)}
        title={task.title}
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
            {commonActions()}
          </ActionPanel>
        }
      />
    );
  }

  const answer = result?.answer;
  const meetings = timedMeetings(answer?.upcomingMeetings);
  // Judge against the real clock, not the last tick, so a meeting is gone the moment it ends.
  const meeting = soonMeeting(meetings, Date.now(), prefs.meetingWindowMinutes);

  return (
    <List
      isLoading={running}
      isShowingDetail={running || !!error || !!answer}
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
          {answer.flags.length > 0 && (
            <List.Section title="Notes">
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
                      {commonActions()}
                    </ActionPanel>
                  }
                />
              ))}
            </List.Section>
          )}
        </>
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
