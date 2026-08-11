import { Clipboard, LaunchProps, open, showHUD, showToast, Toast } from "@raycast/api";
import { basename } from "path";
import { getPreferences } from "./lib/prefs";
import { createScratchFolder } from "./lib/scratch";

type Args = { label?: string };

export default async function main(props: LaunchProps<{ arguments: Args }>): Promise<void> {
  const prefs = getPreferences();
  const label = props.arguments?.label;

  let path: string;
  try {
    path = await createScratchFolder(prefs, label);
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could not create scratch folder",
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (!prefs.openInEditor) {
    await Clipboard.copy(path);
    await showHUD(`Created ${basename(path)} — path copied`);
    return;
  }

  // Prefer the picked app's path; fall back to the bundle id, then to the plain name so a
  // blank preference still lands in VS Code when it is installed.
  const editor = prefs.editorApp?.path ?? prefs.editorApp?.bundleId ?? "Visual Studio Code";
  try {
    await open(path, editor);
    await showHUD(`Created ${basename(path)}`);
  } catch (error) {
    await Clipboard.copy(path);
    await showToast({
      style: Toast.Style.Failure,
      title: `Created ${basename(path)}, but could not open ${prefs.editorApp?.name ?? editor}`,
      message: `Path copied to clipboard. ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
