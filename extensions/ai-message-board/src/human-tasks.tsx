import { Action, ActionPanel, Icon, Keyboard, List, type LaunchProps } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import type { HumanTask } from "./board";
import { humanTaskMarkdown, plain } from "./format";
import { CommentForm, FailureView, ResolveForm, boardClient, showInBoard } from "./shared";

/** The open human tasks, plus the one the menu bar opened if it was closed meanwhile, so you see what became of it. */
async function load(wanted: number | undefined): Promise<HumanTask[]> {
  const client = boardClient();
  const { humanTasks } = await client.attention();
  if (wanted !== undefined && !humanTasks.some((t) => t.id === wanted)) {
    try {
      humanTasks.unshift(await client.humanTask(wanted));
    } catch {
      // It's gone: show the rest.
    }
  }
  return humanTasks;
}

const CLOSED_TAG: Record<HumanTask["status"], string> = {
  open: "",
  done: "Done",
  declined: "Can't Do",
  withdrawn: "Withdrawn",
};

export default function HumanTasks(props: LaunchProps<{ launchContext: { id?: number } }>) {
  const wanted = typeof props.launchContext?.id === "number" ? props.launchContext.id : undefined;
  const { data, isLoading, error, revalidate } = useCachedPromise(load, [wanted], {
    keepPreviousData: true,
    // Shown in the list instead of a toast.
    onError: () => undefined,
  });
  const tasks = error ? [] : (data ?? []);

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={tasks.length > 0}
      selectedItemId={wanted !== undefined ? String(wanted) : undefined}
      searchBarPlaceholder="Search human tasks"
    >
      {error ? (
        <FailureView error={error} onRetry={revalidate} />
      ) : (
        <List.EmptyView
          icon={Icon.CheckCircle}
          title="Nothing for you to do"
          description="Agents ask you here when they need something only you can do."
        />
      )}
      {tasks.map((t) => (
        <List.Item
          key={t.id}
          id={String(t.id)}
          title={`H-${t.id}  ${plain(t.title)}`}
          keywords={[t.channel, t.requestedBy]}
          accessories={t.status === "open" ? [] : [{ tag: CLOSED_TAG[t.status] }]}
          detail={<List.Item.Detail markdown={humanTaskMarkdown(t)} />}
          actions={
            <ActionPanel>
              {t.status === "open" ? (
                <>
                  <Action.Push
                    title="Mark Done…"
                    icon={Icon.CheckCircle}
                    target={<ResolveForm task={t} outcome="done" onDone={revalidate} />}
                  />
                  <Action.Push
                    title="Can't Do It…"
                    icon={Icon.XMarkCircle}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "x" }}
                    target={<ResolveForm task={t} outcome="declined" onDone={revalidate} />}
                  />
                </>
              ) : null}
              <Action.Push
                title="Comment…"
                icon={Icon.SpeechBubble}
                shortcut={Keyboard.Shortcut.Common.New}
                target={
                  <CommentForm
                    title={`Comment on H-${t.id}`}
                    send={(content) => boardClient().commentHumanTask(t.id, content)}
                    onDone={revalidate}
                  />
                }
              />
              <Action
                title="Open in AI Message Board"
                icon={Icon.AppWindow}
                shortcut={Keyboard.Shortcut.Common.Open}
                onAction={() => showInBoard("humanTask", t.id)}
              />
              <Action
                title="Refresh"
                icon={Icon.ArrowClockwise}
                shortcut={Keyboard.Shortcut.Common.Refresh}
                onAction={revalidate}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
