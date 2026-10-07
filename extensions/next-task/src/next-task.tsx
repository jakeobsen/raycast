import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatAge, formatElapsed, formatStartsIn, formatTimeRange, isLink, modelName } from "./lib/format";
import { EditWorkflow } from "./edit-workflow";
import { getPreferences } from "./lib/prefs";
import { renderWorkflow, type Meeting, type Task, type TaskSource, type WorkflowSource } from "./lib/prompt";
import { loadError, loadResult, RunWatcher, startRun, stopRun, type RunProgress } from "./lib/run";
import { loadSavedWorkflow } from "./lib/workflow-store";

/** The stream file is cheap to tail, and a second is fine-grained enough for a run that takes a minute. */
const POLL_MS = 1000;

const SOURCES: Record<TaskSource, { label: string; icon: Icon; color: Color }> = {
  bau: { label: "BAU", icon: Icon.Hammer, color: Color.Orange },
  jira: { label: "Jira", icon: Icon.Ticket, color: Color.Blue },
  slack: { label: "Slack", icon: Icon.Message, color: Color.Purple },
  email: { label: "Email", icon: Icon.Envelope, color: Color.Red },
  calendar: { label: "Calendar", icon: Icon.Calendar, color: Color.Green },
};

function sourceOf(task: Task) {
  return SOURCES[task.source] ?? { label: task.source, icon: Icon.Circle, color: Color.SecondaryText };
}

const WORKFLOW_LABELS: Record<WorkflowSource, string> = {
  saved: "Saved in Raycast",
  example: "Built-in example (⌘E to set yours)",
};

/**
 * Details are written into the markdown rather than Raycast's metadata panel: the panel is
 * pinned to the bottom with its own scroll, while markdown makes the whole right half one
 * scrolling page.
 */
function detailLines(fields: [label: string, value: string | undefined][]): string {
  return fields
    .filter(([, value]) => value)
    .map(([label, value]) => `**${label}**  ${value}`)
    .join("\n\n");
}

/** "[example.slack.com/archives/…](<https://…>)": readable text, the full URL as the target. */
function markdownLink(url: string): string {
  const bare = url.replace(/^https?:\/\//, "");
  const text = (bare.length > 60 ? `${bare.slice(0, 57)}…` : bare).replace(/[[\]]/g, "\\$&");
  return `[${text}](<${url}>)`;
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
        icon={{ source: virtual ? Icon.Video : Icon.TwoPeople, tintColor: Color.Green }}
        title={meeting.title}
        subtitle={when}
        detail={
          <List.Item.Detail
            markdown={[
              `## ${meeting.title}`,
              `**${when}**`,
              meeting.notes,
              "---",
              detailLines([
                ["Join", virtual ? markdownLink(meeting.url) : undefined],
                [virtual ? "Location" : "Where", meeting.location || (virtual ? undefined : "No location given")],
                ["With", meeting.attendees.join(", ")],
              ]),
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

  /** A task's detail shows only the task: what, why, where it came from and its link. */
  function taskItem(task: Task, key: string) {
    const source = sourceOf(task);
    return (
      <List.Item
        key={key}
        icon={{ source: source.icon, tintColor: source.color }}
        title={task.title}
        detail={
          <List.Item.Detail
            markdown={[
              `## ${task.title}`,
              task.why,
              "---",
              detailLines([
                ["Source", source.label],
                ["Link", isLink(task.url) ? markdownLink(task.url) : undefined],
              ]),
            ].join("\n\n")}
          />
        }
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
  const meeting = soonMeeting(meetings, now, prefs.meetingWindowMinutes);

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
                  "---",
                  detailLines([
                    ["Model", modelName(prefs.model)],
                    ["Effort", prefs.effort],
                    ["Workflow", WORKFLOW_LABELS[progress.workflow]],
                    [
                      "Unknown placeholders",
                      progress.unknownPlaceholders.length > 0 ? progress.unknownPlaceholders.join(", ") : undefined,
                    ],
                  ]),
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
