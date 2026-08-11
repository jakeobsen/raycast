import {
  Action,
  ActionPanel,
  Alert,
  closeMainWindow,
  Color,
  confirmAlert,
  Icon,
  Keyboard,
  List,
  open,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { existsSync } from "fs";
import { useMemo } from "react";
import { isGitRepo, openGitRemote, openInGitClient } from "./lib/git";
import { getPreferences, type ScratchPreferences } from "./lib/prefs";
import {
  createScratchFolder,
  formatAge,
  listScratchFolders,
  removeScratchFolder,
  type ScratchFolder,
} from "./lib/scratch";
import { tildify } from "./lib/util";

function deleteVerb(prefs: ScratchPreferences): string {
  return prefs.deleteMode === "permanent" ? "Delete Permanently" : "Move to Trash";
}

function editorTarget(prefs: ScratchPreferences): string {
  return prefs.editorApp?.path ?? prefs.editorApp?.bundleId ?? "Visual Studio Code";
}

/** "Visual Studio Code" → "Code", matching the sibling VS Code extension's action titles. */
function editorShortName(prefs: ScratchPreferences): string {
  return prefs.editorApp?.name.replace(/^Visual Studio /, "") ?? "Editor";
}

export default function Command() {
  const prefs = useMemo(getPreferences, []);
  const terminalPath = prefs.terminalApp?.path ?? "";
  const terminalInstalled = !!terminalPath && existsSync(terminalPath);

  const { data, isLoading, revalidate } = usePromise(
    (root: string, staleDays: number) => listScratchFolders(root, staleDays),
    [prefs.scratchRoot, prefs.staleDays],
    {
      onError: async (error) => {
        await showToast({
          style: Toast.Style.Failure,
          title: "Could not read scratch folders",
          message: error.message,
        });
      },
    },
  );

  const folders = data ?? [];
  // Browsing wants the freshest thing first; cleanup wants the mustiest first. Sort each
  // section for its own purpose rather than picking one order for the whole list.
  const active = folders.filter((folder) => !folder.stale).sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
  const stale = folders.filter((folder) => folder.stale).sort((a, b) => a.lastModifiedMs - b.lastModifiedMs);

  async function createAndOpen() {
    try {
      const path = await createScratchFolder(prefs, undefined);
      if (prefs.openInEditor) {
        await open(path, editorTarget(prefs));
        await closeMainWindow();
      } else {
        await showToast({ style: Toast.Style.Success, title: `Created ${tildify(path)}` });
      }
      revalidate();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not create scratch folder",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function removeOne(folder: ScratchFolder) {
    const confirmed = await confirmAlert({
      title: `${deleteVerb(prefs)}?`,
      message: `${tildify(folder.path)}\nLast modified ${formatAge(folder.lastModifiedMs)}.`,
      icon: Icon.Trash,
      primaryAction: {
        title: deleteVerb(prefs),
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;

    try {
      await removeScratchFolder(prefs.scratchRoot, folder.path, prefs.deleteMode);
      await showToast({
        style: Toast.Style.Success,
        title: `Removed ${folder.name}`,
      });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: `Could not remove ${folder.name}`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    revalidate();
  }

  async function removeAllStale() {
    if (stale.length === 0) {
      await showToast({
        style: Toast.Style.Success,
        title: "Nothing to clean up",
      });
      return;
    }

    const preview = stale.slice(0, 10).map((folder) => `• ${folder.name} (${formatAge(folder.lastModifiedMs)})`);
    if (stale.length > preview.length) preview.push(`• …and ${stale.length - preview.length} more`);

    const confirmed = await confirmAlert({
      title: `${deleteVerb(prefs)}: ${stale.length} scratch folder${stale.length === 1 ? "" : "s"}?`,
      message: `Untouched for at least ${prefs.staleDays} day${prefs.staleDays === 1 ? "" : "s"}:\n${preview.join("\n")}`,
      icon: Icon.Trash,
      primaryAction: {
        title: `${deleteVerb(prefs)} (${stale.length})`,
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Cleaning up ${stale.length} folders…`,
    });
    let removed = 0;
    const failures: string[] = [];
    for (const folder of stale) {
      try {
        await removeScratchFolder(prefs.scratchRoot, folder.path, prefs.deleteMode);
        removed++;
      } catch (error) {
        failures.push(`${folder.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    toast.style = failures.length > 0 ? Toast.Style.Failure : Toast.Style.Success;
    toast.title = `Removed ${removed} of ${stale.length} folder${stale.length === 1 ? "" : "s"}`;
    toast.message = failures.length > 0 ? failures.join("\n") : undefined;
    revalidate();
  }

  async function openGitClient(folder: ScratchFolder) {
    if (!isGitRepo(folder.path)) {
      await showToast({ style: Toast.Style.Failure, title: "Not a git repository" });
      return;
    }
    try {
      await openInGitClient(folder.path, prefs.gitClientApp, terminalPath || undefined);
      await closeMainWindow();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to launch git client",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function openRemote(folder: ScratchFolder) {
    if (!isGitRepo(folder.path)) {
      await showToast({ style: Toast.Style.Failure, title: "Not a git repository" });
      return;
    }
    await openGitRemote(folder.path);
  }

  // Shortcuts mirror the better-visual-studio-code-project-manager extension so muscle
  // memory carries over: ⌘T terminal, ⌘G git client, ⌘⇧G remote, ⌘F Finder, ⌘O open with,
  // ⌘. copy name, ⌘⇧. copy path, ⌃X trash.
  function itemActions(folder: ScratchFolder) {
    return (
      <ActionPanel>
        <ActionPanel.Section>
          <Action.Open
            title={`Open in ${editorShortName(prefs)}`}
            icon={prefs.editorApp ? { fileIcon: prefs.editorApp.path } : Icon.Code}
            target={folder.path}
            application={editorTarget(prefs)}
          />
          {terminalInstalled && (
            <Action.Open
              title="Open in Terminal"
              icon={{ fileIcon: terminalPath }}
              shortcut={{ modifiers: ["cmd"], key: "t" }}
              target={folder.path}
              application={terminalPath}
            />
          )}
          <Action
            title={`Open in ${prefs.gitClientApp}`}
            icon={Icon.Terminal}
            shortcut={{ modifiers: ["cmd"], key: "g" }}
            onAction={() => openGitClient(folder)}
          />
          <Action
            title="Open Git Remote in Browser"
            icon={Icon.Link}
            shortcut={{ modifiers: ["cmd", "shift"], key: "g" }}
            onAction={() => openRemote(folder)}
          />
          <Action.ShowInFinder path={folder.path} shortcut={{ modifiers: ["cmd"], key: "f" }} />
          <Action.OpenWith path={folder.path} shortcut={Keyboard.Shortcut.Common.Open} />
        </ActionPanel.Section>

        <ActionPanel.Section>
          <Action.CopyToClipboard title="Copy Name" content={folder.name} shortcut={Keyboard.Shortcut.Common.Pin} />
          <Action.CopyToClipboard
            title="Copy Path"
            content={folder.path}
            shortcut={{ modifiers: ["cmd", "shift"], key: "." }}
          />
        </ActionPanel.Section>

        <ActionPanel.Section>
          <Action
            title="Create Scratch Folder"
            icon={Icon.Plus}
            shortcut={Keyboard.Shortcut.Common.New}
            onAction={createAndOpen}
          />
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={revalidate}
          />
        </ActionPanel.Section>

        <ActionPanel.Section>
          <Action
            title={deleteVerb(prefs)}
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            shortcut={{ modifiers: ["ctrl"], key: "x" }}
            onAction={() => removeOne(folder)}
          />
          <Action
            title="Clean up All Stale Folders"
            icon={Icon.XMarkCircle}
            style={Action.Style.Destructive}
            shortcut={{ modifiers: ["cmd", "shift"], key: "x" }}
            onAction={removeAllStale}
          />
        </ActionPanel.Section>
      </ActionPanel>
    );
  }

  function item(folder: ScratchFolder) {
    const accessories: List.Item.Accessory[] = [];
    if (!folder.meta) {
      accessories.push({
        icon: { source: Icon.Pin, tintColor: Color.SecondaryText },
        tooltip: "No .scratch.json marker — this folder was not made by Create Scratch.",
      });
    }
    if (folder.truncated) {
      accessories.push({
        tag: { value: "large tree", color: Color.Orange },
        tooltip: "Too many files to scan fully — kept out of stale cleanup to be safe.",
      });
    }
    accessories.push({
      tag: {
        value: formatAge(folder.lastModifiedMs),
        color: folder.stale ? Color.Red : Color.SecondaryText,
      },
      tooltip: `Newest change inside the folder: ${new Date(folder.lastModifiedMs).toLocaleString()}`,
    });

    return (
      <List.Item
        key={folder.path}
        title={folder.name}
        subtitle={folder.meta?.label}
        icon={{ fileIcon: folder.path }}
        keywords={folder.meta?.label?.split(/\s+/)}
        accessories={accessories}
        actions={itemActions(folder)}
      />
    );
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder={`Search scratch folders in ${tildify(prefs.scratchRoot)}`}>
      <List.EmptyView
        icon={Icon.Folder}
        title={isLoading ? "Scanning scratch folders…" : "No scratch folders"}
        description={`Nothing in ${tildify(prefs.scratchRoot)} yet — ⌘N makes one.`}
        actions={
          <ActionPanel>
            <Action title="Create Scratch Folder" icon={Icon.Plus} onAction={createAndOpen} />
            <Action title="Open Scratch Root" icon={Icon.Finder} onAction={() => open(prefs.scratchRoot)} />
            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={revalidate}
            />
          </ActionPanel>
        }
      />
      <List.Section title="Active" subtitle={active.length > 0 ? `${active.length}` : undefined}>
        {active.map((folder) => item(folder))}
      </List.Section>
      <List.Section
        title={`Stale — untouched ${prefs.staleDays}+ days`}
        subtitle={stale.length > 0 ? `${stale.length}` : undefined}
      >
        {stale.map((folder) => item(folder))}
      </List.Section>
    </List>
  );
}
