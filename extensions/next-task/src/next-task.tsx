import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, Keyboard, List, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatAge, formatCost, formatDuration, formatElapsed, isLink, modelName } from "./lib/format";
import { EditWorkflow } from "./edit-workflow";
import { getPreferences } from "./lib/prefs";
import { renderWorkflow, type Task, type TaskSource, type WorkflowSource } from "./lib/prompt";
import { loadError, loadResult, RunWatcher, startRun, stopRun, type RunProgress, type StoredResult } from "./lib/run";
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

  function runMetadata(stored: StoredResult) {
    return (
      <>
        <List.Item.Detail.Metadata.Separator />
        <List.Item.Detail.Metadata.Label title="On BAU" text={stored.answer.onBau ? "Yes" : "No"} />
        <List.Item.Detail.Metadata.Label title="Next Meeting" text={stored.answer.nextMeeting} />
        <List.Item.Detail.Metadata.Separator />
        <List.Item.Detail.Metadata.Label title="Workflow" text={WORKFLOW_LABELS[stored.workflow] ?? stored.workflow} />
        <List.Item.Detail.Metadata.Label title="Model" text={modelName(stored.model)} />
        <List.Item.Detail.Metadata.Label title="Took" text={formatDuration(stored.durationMs)} />
        <List.Item.Detail.Metadata.Label title="Cost" text={formatCost(stored.costUsd)} />
        <List.Item.Detail.Metadata.Label title="Asked" text={formatAge(stored.finishedAt, now)} />
        {stored.denied.length > 0 && (
          <List.Item.Detail.Metadata.Label
            title="Refused Tool Calls"
            text={stored.denied.join(", ")}
            icon={{ source: Icon.Warning, tintColor: Color.Red }}
          />
        )}
      </>
    );
  }

  function taskItem(task: Task, stored: StoredResult, key: string) {
    const source = sourceOf(task);
    return (
      <List.Item
        key={key}
        icon={{ source: source.icon, tintColor: source.color }}
        title={task.title}
        detail={
          <List.Item.Detail
            markdown={`## ${task.title}\n\n${task.why}`}
            metadata={
              <List.Item.Detail.Metadata>
                <List.Item.Detail.Metadata.TagList title="Source">
                  <List.Item.Detail.Metadata.TagList.Item text={source.label} color={source.color} />
                </List.Item.Detail.Metadata.TagList>
                {isLink(task.url) && <List.Item.Detail.Metadata.Link title="Link" text={task.url} target={task.url} />}
                {runMetadata(stored)}
              </List.Item.Detail.Metadata>
            }
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
  const summary = result
    ? `${answer?.onBau ? "On BAU" : "Not on BAU"} · ${modelName(result.model)} · ${formatAge(result.finishedAt, now)}`
    : undefined;

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
                markdown={
                  "Claude is reading your calendar, Jira, Slack and Gmail with read-only tools.\n\n" +
                  "You can close Raycast. The run keeps going, and the answer will be here next time you open **Next Task**." +
                  (progress.workflow === "example"
                    ? "\n\nNo workflow saved yet, so this run uses the built-in example. Press **⌘E** to set your own."
                    : "")
                }
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Model" text={modelName(prefs.model)} />
                    <List.Item.Detail.Metadata.Label title="Effort" text={prefs.effort} />
                    <List.Item.Detail.Metadata.Label title="Workflow" text={WORKFLOW_LABELS[progress.workflow]} />
                    {progress.unknownPlaceholders.length > 0 && (
                      <List.Item.Detail.Metadata.Label
                        title="Unknown Placeholders"
                        text={progress.unknownPlaceholders.join(", ")}
                        icon={{ source: Icon.Warning, tintColor: Color.Red }}
                      />
                    )}
                  </List.Item.Detail.Metadata>
                }
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
          <List.Section title="Next" subtitle={summary}>
            {taskItem(answer.next, result, "next")}
          </List.Section>
          {answer.alternatives.length > 0 && (
            <List.Section title="Alternatives">
              {answer.alternatives.map((task, index) => taskItem(task, result, `alternative-${index}`))}
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
