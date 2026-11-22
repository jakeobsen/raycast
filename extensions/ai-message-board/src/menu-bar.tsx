import { Icon, LaunchType, MenuBarExtra, launchCommand, openExtensionPreferences, showHUD } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { BoardFailure, type Reconnect } from "./board";
import { ago, plain } from "./format";
import { boardClient, failureMessage, openBoardApp } from "./shared";

/** Opens a decision or human task on its screen in the launcher, where its full context is shown. */
async function openScreen(command: "decisions" | "human-tasks", id: number): Promise<void> {
  try {
    await launchCommand({ name: command, type: LaunchType.UserInitiated, context: { id } });
  } catch (error) {
    await showHUD(`Couldn't open it: ${failureMessage(error)}`);
  }
}

/** Whether the agent's current session is still at work: that decides a reconnect. */
function currentSession(r: Reconnect): string {
  if (r.lastSeenAt === null) return "agent gone";
  if (r.waiting) return "current session listening now";
  return `current session last active ${ago(r.lastSeenAt)}`;
}

function FailureSection({ error }: { error: Error }) {
  const kind = error instanceof BoardFailure ? error.kind : "refused";
  const title =
    kind === "offline"
      ? "AI Message Board isn't running"
      : kind === "token"
        ? "The board refused the API token"
        : kind === "outdated"
          ? "Update AI Message Board to use this menu"
          : "Couldn't load the board";
  return (
    <MenuBarExtra.Section>
      <MenuBarExtra.Item title={title} icon={Icon.Warning} tooltip={failureMessage(error)} />
      {kind === "token" ? (
        <MenuBarExtra.Item title="Open Extension Settings…" icon={Icon.Gear} onAction={openExtensionPreferences} />
      ) : null}
    </MenuBarExtra.Section>
  );
}

export default function WaitingOnYou() {
  const { data, isLoading, error, revalidate } = useCachedPromise(() => boardClient().attention(), [], {
    keepPreviousData: true,
    // Shown in the menu instead of a toast.
    onError: () => undefined,
  });
  // Never show what was waiting before the board went away as if it still were.
  const live = error ? undefined : data;
  const count = live
    ? live.decisions.length + live.humanTasks.length + live.reconnects.length + live.joinRequests.length
    : 0;

  async function act(run: () => Promise<void>, done: string): Promise<void> {
    try {
      await run();
      await showHUD(done);
    } catch (e) {
      await showHUD(`Couldn't do it: ${failureMessage(e)}`);
    }
    revalidate();
  }

  return (
    <MenuBarExtra
      icon={Icon.SpeechBubble}
      title={count > 0 ? String(count) : undefined}
      tooltip={count > 0 ? `${count} waiting on you in AI Message Board` : "AI Message Board"}
      isLoading={isLoading}
    >
      {error ? <FailureSection error={error} /> : null}
      {live && count === 0 ? <MenuBarExtra.Item title="Nothing is waiting on you" icon={Icon.CheckCircle} /> : null}

      {live && live.decisions.length > 0 ? (
        <MenuBarExtra.Section title="Decisions">
          {live.decisions.map((d) => (
            <MenuBarExtra.Item
              key={d.id}
              title={`D-${d.id}  ${plain(d.question, 70)}`}
              subtitle={`#${d.channel} · ${d.askedBy} · ${ago(d.createdAt)}`}
              tooltip={plain(d.context, 400) || undefined}
              onAction={() => openScreen("decisions", d.id)}
            />
          ))}
        </MenuBarExtra.Section>
      ) : null}

      {live && live.humanTasks.length > 0 ? (
        <MenuBarExtra.Section title="Human Tasks">
          {live.humanTasks.map((t) => (
            <MenuBarExtra.Item
              key={t.id}
              title={`H-${t.id}  ${plain(t.title, 70)}`}
              subtitle={`#${t.channel} · ${t.requestedBy} · ${ago(t.createdAt)}`}
              tooltip={plain(t.details, 400) || undefined}
              onAction={() => openScreen("human-tasks", t.id)}
            />
          ))}
        </MenuBarExtra.Section>
      ) : null}

      {live && live.reconnects.length > 0 ? (
        <MenuBarExtra.Section title="Reconnects">
          {live.reconnects.map((r) => (
            <MenuBarExtra.Submenu
              key={r.name}
              title={`${r.name} wants to reconnect · ${currentSession(r)}`}
              icon={Icon.Person}
            >
              {r.role ? (
                <MenuBarExtra.Item
                  title={`New session's role: ${plain(r.role, 60)}`}
                  tooltip={r.description || undefined}
                />
              ) : null}
              <MenuBarExtra.Item title="Allow it when the current session has stopped; deny it while that one still works." />
              <MenuBarExtra.Item
                title="Allow"
                icon={Icon.CheckCircle}
                onAction={() => act(() => boardClient().resolveReconnect(r.name, true), `Let ${r.name} reconnect`)}
              />
              <MenuBarExtra.Item
                title="Deny"
                icon={Icon.XMarkCircle}
                onAction={() =>
                  act(() => boardClient().resolveReconnect(r.name, false), `Denied ${r.name}'s reconnect`)
                }
              />
            </MenuBarExtra.Submenu>
          ))}
        </MenuBarExtra.Section>
      ) : null}

      {live && live.joinRequests.length > 0 ? (
        <MenuBarExtra.Section title="Join Requests">
          {live.joinRequests.map((j) => (
            <MenuBarExtra.Submenu
              key={`${j.channel}/${j.agent}`}
              title={`${j.agent} wants to join #${j.channel}`}
              icon={Icon.TwoPeople}
            >
              {j.role ? (
                <MenuBarExtra.Item title={`${j.agent}: ${plain(j.role, 60)}`} tooltip={j.description || undefined} />
              ) : null}
              <MenuBarExtra.Item
                title="Allow"
                icon={Icon.CheckCircle}
                onAction={() =>
                  act(
                    () => boardClient().resolveJoinRequest(j.channel, j.agent, true),
                    `Let ${j.agent} into #${j.channel}`,
                  )
                }
              />
              <MenuBarExtra.Item
                title="Deny"
                icon={Icon.XMarkCircle}
                onAction={() =>
                  act(
                    () => boardClient().resolveJoinRequest(j.channel, j.agent, false),
                    `Kept ${j.agent} out of #${j.channel}`,
                  )
                }
              />
            </MenuBarExtra.Submenu>
          ))}
        </MenuBarExtra.Section>
      ) : null}

      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="Open AI Message Board"
          icon={Icon.AppWindow}
          onAction={() => openBoardApp().catch((e) => showHUD(failureMessage(e)))}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
