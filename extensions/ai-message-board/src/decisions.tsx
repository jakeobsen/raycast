import { Action, ActionPanel, Icon, Keyboard, List, type LaunchProps } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import type { Decision } from "./board";
import { decisionMarkdown, plain } from "./format";
import { AnswerForm, CommentForm, FailureView, boardClient, showInBoard } from "./shared";

/** The open decisions, plus the one the menu bar opened if it was answered meanwhile, so you see what became of it. */
async function load(wanted: number | undefined): Promise<Decision[]> {
  const client = boardClient();
  const { decisions } = await client.attention();
  if (wanted !== undefined && !decisions.some((d) => d.id === wanted)) {
    try {
      decisions.unshift(await client.decision(wanted));
    } catch {
      // It's gone: show the rest.
    }
  }
  return decisions;
}

export default function Decisions(props: LaunchProps<{ launchContext: { id?: number } }>) {
  const wanted = typeof props.launchContext?.id === "number" ? props.launchContext.id : undefined;
  const { data, isLoading, error, revalidate } = useCachedPromise(load, [wanted], {
    keepPreviousData: true,
    // Shown in the list instead of a toast.
    onError: () => undefined,
  });
  const decisions = error ? [] : (data ?? []);

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={decisions.length > 0}
      selectedItemId={wanted !== undefined ? String(wanted) : undefined}
      searchBarPlaceholder="Search decisions"
    >
      {error ? (
        <FailureView error={error} onRetry={revalidate} />
      ) : (
        <List.EmptyView
          icon={Icon.CheckCircle}
          title="No decisions waiting on you"
          description="A channel's orchestrator asks you here when something needs your call."
        />
      )}
      {decisions.map((d) => (
        <List.Item
          key={d.id}
          id={String(d.id)}
          title={`D-${d.id}  ${plain(d.question)}`}
          keywords={[d.channel, d.askedBy]}
          accessories={d.status === "open" ? [] : [{ tag: d.status === "answered" ? "Answered" : "Closed" }]}
          detail={<List.Item.Detail markdown={decisionMarkdown(d)} />}
          actions={
            <ActionPanel>
              {d.status === "open" ? (
                <Action.Push
                  title="Answer…"
                  icon={Icon.CheckCircle}
                  target={<AnswerForm decision={d} onDone={revalidate} />}
                />
              ) : null}
              <Action.Push
                title="Comment…"
                icon={Icon.SpeechBubble}
                shortcut={Keyboard.Shortcut.Common.New}
                target={
                  <CommentForm
                    title={`Comment on D-${d.id}`}
                    send={(content) => boardClient().commentDecision(d.id, content)}
                    onDone={revalidate}
                  />
                }
              />
              <Action
                title="Open in AI Message Board"
                icon={Icon.AppWindow}
                shortcut={Keyboard.Shortcut.Common.Open}
                onAction={() => showInBoard("decision", d.id)}
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
