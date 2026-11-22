import { execFile } from "node:child_process";
import {
  Action,
  ActionPanel,
  Form,
  Icon,
  List,
  getPreferenceValues,
  openExtensionPreferences,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useState } from "react";
import { BoardClient, BoardFailure, type Decision, type HumanTask } from "./board";
import { plain } from "./format";

interface Preferences {
  token: string;
  address?: string;
}

export function boardClient(): BoardClient {
  const { token, address } = getPreferenceValues<Preferences>();
  return new BoardClient(address || "http://127.0.0.1:41414", token);
}

const BUNDLE_ID = "com.jakeobsen.ai-message-board";

/** Opens (or brings forward) the AI Message Board app. */
export function openBoardApp(): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile("/usr/bin/open", ["-b", BUNDLE_ID], (error) =>
      error ? reject(new Error("AI Message Board isn't installed.")) : resolve(),
    ),
  );
}

export function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function showFailure(title: string, error: unknown): Promise<void> {
  await showToast({ style: Toast.Style.Failure, title, message: failureMessage(error) });
}

/** What a list shows when the board can't be reached, with the action that fixes it. */
export function FailureView({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const kind = error instanceof BoardFailure ? error.kind : "refused";
  const title =
    kind === "offline"
      ? "AI Message Board isn't running"
      : kind === "token"
        ? "The board refused the token"
        : kind === "outdated"
          ? "Update AI Message Board"
          : "Couldn't load the board";
  return (
    <List.EmptyView
      icon={Icon.Warning}
      title={title}
      description={failureMessage(error)}
      actions={
        <ActionPanel>
          {kind === "token" ? (
            <Action title="Open Extension Settings" icon={Icon.Gear} onAction={openExtensionPreferences} />
          ) : (
            <Action
              title="Open AI Message Board"
              icon={Icon.AppWindow}
              onAction={() => openBoardApp().catch((e) => showFailure("Couldn't open it", e))}
            />
          )}
          <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={onRetry} />
        </ActionPanel>
      }
    />
  );
}

/** Brings the board app forward with the item in view. */
export async function showInBoard(kind: "decision" | "humanTask", id: number): Promise<void> {
  try {
    await boardClient().show(kind, id);
  } catch (error) {
    await showFailure("Couldn't open it in the board", error);
  }
}

export function AnswerForm({ decision: d, onDone }: { decision: Decision; onDone: () => void }) {
  const { pop } = useNavigation();
  const [choice, setChoice] = useState(String(d.recommended));
  const [busy, setBusy] = useState(false);

  async function submit(values: { choice: string; other?: string; note?: string }) {
    const option = values.choice === "other" ? null : Number(values.choice);
    if (option === null && !values.other?.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Write your answer, or pick an option" });
      return;
    }
    setBusy(true);
    try {
      await boardClient().answerDecision(d.id, { option, other: values.other ?? "", note: values.note ?? "" });
      await showToast({ style: Toast.Style.Success, title: `Answered D-${d.id}` });
      onDone();
      pop();
    } catch (error) {
      await showFailure(`Couldn't answer D-${d.id}`, error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Form
      navigationTitle={`Answer D-${d.id}`}
      isLoading={busy}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Answer" icon={Icon.CheckCircle} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.Description title="Question" text={plain(d.question)} />
      <Form.Dropdown id="choice" title="Answer" value={choice} onChange={setChoice}>
        {d.options.map((o, i) => (
          <Form.Dropdown.Item
            key={i}
            value={String(i)}
            title={`${i + 1}. ${plain(o.label)}${i === d.recommended ? " (recommended)" : ""}`}
          />
        ))}
        <Form.Dropdown.Item value="other" title="Other…" />
      </Form.Dropdown>
      {choice === "other" ? (
        <Form.TextArea id="other" title="Your Answer" placeholder="Answer in your own words" />
      ) : null}
      <Form.TextArea id="note" title="Note" placeholder="Optional: why, or what to watch out for" />
    </Form>
  );
}

export function ResolveForm({
  task: t,
  outcome,
  onDone,
}: {
  task: HumanTask;
  outcome: "done" | "declined";
  onDone: () => void;
}) {
  const { pop } = useNavigation();
  const [busy, setBusy] = useState(false);
  const verb = outcome === "done" ? "Mark Done" : "Can't Do It";

  async function submit(values: { note?: string }) {
    setBusy(true);
    try {
      await boardClient().resolveHumanTask(t.id, outcome, values.note ?? "");
      await showToast({
        style: Toast.Style.Success,
        title: outcome === "done" ? `Marked H-${t.id} done` : `Told them you can't do H-${t.id}`,
      });
      onDone();
      pop();
    } catch (error) {
      await showFailure(`Couldn't update H-${t.id}`, error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Form
      navigationTitle={`${verb}: H-${t.id}`}
      isLoading={busy}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={verb}
            icon={outcome === "done" ? Icon.CheckCircle : Icon.XMarkCircle}
            onSubmit={submit}
          />
        </ActionPanel>
      }
    >
      <Form.Description title="Task" text={plain(t.title)} />
      <Form.TextArea
        id="note"
        title="Note"
        placeholder={
          outcome === "done" ? "Optional: anything the agent should know" : "Optional: why, or who could do it"
        }
      />
    </Form>
  );
}

export function CommentForm({
  title,
  send,
  onDone,
}: {
  title: string;
  send: (content: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const { pop } = useNavigation();
  const [busy, setBusy] = useState(false);

  async function submit(values: { content: string }) {
    if (!values.content.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Write a comment first" });
      return;
    }
    setBusy(true);
    try {
      await send(values.content);
      await showToast({ style: Toast.Style.Success, title: "Comment sent" });
      onDone();
      pop();
    } catch (error) {
      await showFailure("Couldn't send the comment", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Form
      navigationTitle={title}
      isLoading={busy}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send Comment" icon={Icon.SpeechBubble} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextArea id="content" title="Comment" placeholder="Markdown works" />
    </Form>
  );
}
