import {
  Action,
  ActionPanel,
  closeMainWindow,
  Detail,
  environment,
  getPreferenceValues,
  Icon,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { useFrecencySorting } from "@raycast/utils";
import { exec } from "child_process";
import { existsSync } from "fs";
import { dirname } from "path";
import { Fragment, ReactElement, useMemo, useState } from "react";
import { isGitRepo, openGitRemote, openInGitClient } from "./actions";
import {
  filterProjectsByTag,
  getDefaultStoragePath,
  getProjectEntries,
  getProjectsGroupedByTag,
  getProjectsLocationPath,
  getProjectTags,
} from "./projects";
import { Preferences, ProjectEntry } from "./types";
import { escapeRegex, tildify } from "./util";

const preferences: Preferences = getPreferenceValues();

const terminalPath = preferences.terminalApp?.path ?? "";
const terminalInstalled = !!terminalPath && existsSync(terminalPath);

const vscodeApp = preferences.vscodeApp;
const vscodeAppNameShort = vscodeApp?.name.replace(/^Visual Studio /, "") ?? "";
const vscodeAppCLI = vscodeApp ? `${vscodeApp.path}/Contents/Resources/app/bin/code` : "";

const remotePrefix = "vscode-remote://";

function isRemoteProject(path: string): boolean {
  return path.startsWith(remotePrefix);
}

function parseRemoteURL(path: string): string {
  const stripped = path.slice(remotePrefix.length);
  const index = stripped.indexOf("/");
  return stripped.slice(0, index) + " " + stripped.slice(index) + "/";
}

type FrecencyReturnType<T extends { id: string }> = ReturnType<typeof useFrecencySorting<T>>;
type FrecencyUpdateType<T extends { id: string }> = Pick<FrecencyReturnType<T>, "visitItem" | "resetRanking">;

export default function Command() {
  if (!vscodeApp) {
    return (
      <ExtensionError detail="Please configure the **Project Manager** Raycast extension to choose which version of Visual Studio Code to use." />
    );
  }

  const { path: projectsLocationPath, error: projectsLocationError } = getProjectsLocationPath(preferences);
  if (projectsLocationError) {
    return (
      <ExtensionError
        detail={
          "## Invalid Projects Location\n\n```\n" +
          projectsLocationPath +
          "\n```\n\nPlease review the **Projects Location** setting in the extension configuration."
        }
      />
    );
  }

  const projectEntries = getProjectEntries(projectsLocationPath, preferences);
  const projectTags = getProjectTags(projectEntries);

  const [selectedTag, setSelectedTag] = useState("");

  if (!projectEntries || projectEntries.length === 0) {
    return (
      <ExtensionError detail="No projects found. Ensure `projects.json` exists in the configured **Projects Location**." />
    );
  }

  const {
    data: sortedProjects,
    visitItem,
    resetRanking,
  } = useFrecencySorting(projectEntries, {
    key: (item) => item.rootPath,
    sortUnvisited: (a, b) => a.name.localeCompare(b.name),
  });
  const updateFrecency = { visitItem, resetRanking };

  const [searchText, setSearchText] = useState("");

  const filteredProjects = useMemo(() => {
    const searchRgx = new RegExp([...searchText].map(escapeRegex).join(".*"), "i");
    return sortedProjects
      .filter((item) => searchRgx.test(item.name))
      .sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const search = searchText.toLowerCase();
        if (aName === search) {
          if (aName === bName) return 0;
          return -1;
        }
        if (bName === search) return 1;
        return +bName.includes(search) - +aName.includes(search);
      });
  }, [searchText, sortedProjects]);

  const elements: ReactElement[] = [];
  if (preferences.groupProjectsByTag && !selectedTag) {
    const grouped = getProjectsGroupedByTag(filteredProjects);
    grouped.forEach((value, key) => {
      elements.push(
        <List.Section key={key} title={key}>
          {value.map((project, index) => (
            <ProjectListItem key={project.rootPath + index} item={project} updateFrecency={updateFrecency} />
          ))}
        </List.Section>,
      );
    });
  } else {
    filterProjectsByTag(filteredProjects, selectedTag).forEach((project, index) => {
      elements.push(<ProjectListItem key={project.rootPath + index} item={project} updateFrecency={updateFrecency} />);
    });
  }

  return (
    <List
      filtering={false}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search projects ..."
      searchBarAccessory={
        projectTags.length ? (
          <List.Dropdown tooltip="Tags filter" onChange={setSelectedTag} defaultValue="">
            <List.Dropdown.Section>
              <List.Dropdown.Item key="0" title="All Tags" value="" />
            </List.Dropdown.Section>
            <List.Dropdown.Section title="Tags">
              {projectTags.map((tag, i) => (
                <List.Dropdown.Item key={"tag-" + i} title={tag} value={tag} />
              ))}
            </List.Dropdown.Section>
          </List.Dropdown>
        ) : null
      }
    >
      <Fragment>{elements}</Fragment>
    </List>
  );
}

function ProjectListItem({
  item,
  updateFrecency,
}: {
  item: ProjectEntry;
  updateFrecency: FrecencyUpdateType<ProjectEntry>;
}) {
  const { name, rootPath, tags } = item;
  const { visitItem, resetRanking } = updateFrecency;
  const prettyPath = tildify(rootPath);
  const subtitle = dirname(prettyPath);
  const remote = isRemoteProject(rootPath);
  const gitRepo = !remote && isGitRepo(rootPath);
  const gitClientCmd = preferences.gitClientApp || "lazygit";

  return (
    <List.Item
      title={name}
      subtitle={subtitle}
      icon={remote ? Icon.Globe : { fileIcon: rootPath }}
      keywords={tags}
      accessories={[{ text: tags?.join(", ") }]}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {remote ? (
              <Action
                title={`Open in ${vscodeApp!.name} (Remote)`}
                icon={{ fileIcon: vscodeApp!.path }}
                onAction={() => {
                  visitItem(item);
                  exec(`"${vscodeAppCLI}" --remote ${parseRemoteURL(rootPath)}`);
                  closeMainWindow();
                }}
              />
            ) : (
              <Action.Open
                title={`Open in ${vscodeAppNameShort}`}
                icon={{ fileIcon: vscodeApp!.path }}
                target={rootPath}
                application={vscodeApp!.path}
                onOpen={() => visitItem(item)}
              />
            )}
            {terminalInstalled && !remote && (
              <Action.Open
                title="Open in Terminal"
                icon={{ fileIcon: terminalPath }}
                shortcut={{ modifiers: ["cmd"], key: "t" }}
                target={rootPath}
                application={terminalPath}
                onOpen={() => visitItem(item)}
              />
            )}
            {gitRepo && (
              <Action
                title={`Open in ${gitClientCmd}`}
                icon={Icon.Terminal}
                shortcut={{ modifiers: ["cmd"], key: "g" }}
                onAction={async () => {
                  visitItem(item);
                  try {
                    await openInGitClient(rootPath, gitClientCmd, terminalPath || undefined);
                    await closeMainWindow();
                  } catch (err) {
                    await showToast({
                      style: Toast.Style.Failure,
                      title: "Failed to launch git client",
                      message: err instanceof Error ? err.message : String(err),
                    });
                  }
                }}
              />
            )}
            {gitRepo && (
              <Action
                title="Open Git Remote in Browser"
                icon={Icon.Link}
                shortcut={{ modifiers: ["cmd", "shift"], key: "g" }}
                onAction={async () => {
                  visitItem(item);
                  await openGitRemote(rootPath);
                }}
              />
            )}
            {!remote && <Action.ShowInFinder path={rootPath} shortcut={{ modifiers: ["cmd"], key: "f" }} />}
            {!remote && (
              <Action.OpenWith path={rootPath} shortcut={{ modifiers: ["cmd"], key: "o" }} onOpen={() => visitItem(item)} />
            )}
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action.CopyToClipboard title="Copy Name" content={name} shortcut={{ modifiers: ["cmd"], key: "." }} />
            <Action.CopyToClipboard
              title="Copy Path"
              content={prettyPath}
              shortcut={{ modifiers: ["cmd", "shift"], key: "." }}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action
              title="Reset Project Ranking"
              icon={Icon.ArrowCounterClockwise}
              onAction={() => resetRanking(item)}
            />
            {!remote && <Action.Trash paths={[rootPath]} shortcut={{ modifiers: ["ctrl"], key: "x" }} />}
          </ActionPanel.Section>
          <DevelopmentActionSection />
        </ActionPanel>
      }
    />
  );
}

function ExtensionError({ detail }: { detail: string }) {
  const { path } = getProjectsLocationPath(preferences);
  return (
    <Detail
      markdown={detail}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="VS Code App" text={vscodeApp?.name ?? "(unset)"} />
          <Detail.Metadata.Label
            title={`Projects Location${preferences.projectManagerDataPath ? "" : " (Default)"}`}
            text={tildify(path || getDefaultStoragePath(vscodeApp?.name))}
          />
        </Detail.Metadata>
      }
    />
  );
}

function DevelopmentActionSection() {
  if (!environment.isDevelopment) return null;
  const { path } = getProjectsLocationPath(preferences);
  const jsonPath = `${path}/projects.json`;
  return (
    <ActionPanel.Section title="Development">
      <Action.ShowInFinder title="Show projects.json in Finder" path={jsonPath} />
      <Action.CopyToClipboard title="Copy projects.json Path" content={jsonPath} />
    </ActionPanel.Section>
  );
}
