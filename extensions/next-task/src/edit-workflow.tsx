import {
  Action,
  ActionPanel,
  Alert,
  Clipboard,
  confirmAlert,
  Form,
  Icon,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import type { NextTaskPreferences } from "./lib/prefs";
import { EXAMPLE_WORKFLOW, PLACEHOLDER_HELP, placeholderValues } from "./lib/prompt";
import { loadSavedWorkflow, saveWorkflow } from "./lib/workflow-store";

type Loaded = { text: string; usingExample: boolean };

/** Edit the workflow that tells Claude what to check and how to judge it. */
export function EditWorkflow({ prefs }: { prefs: NextTaskPreferences }) {
  const { pop } = useNavigation();
  const [loaded, setLoaded] = useState<Loaded>();
  // The text area is uncontrolled: feeding `value` back on every change makes Raycast echo
  // intermediate values, and the box flickers between old and new text until it goes blank.
  // Raycast owns the text; we only read it. Bumping `generation` remounts the text area so
  // a new defaultValue (Replace with Example) takes effect.
  const [generation, setGeneration] = useState(0);
  const latest = useRef("");

  useEffect(() => {
    loadSavedWorkflow().then((saved) => {
      latest.current = saved ?? EXAMPLE_WORKFLOW;
      setLoaded({ text: latest.current, usingExample: !saved });
    });
  }, []);

  async function save(values: { workflow: string }) {
    await saveWorkflow(values.workflow);
    await showToast({ style: Toast.Style.Success, title: "Workflow saved" });
    pop();
  }

  async function replaceWithExample() {
    const confirmed = await confirmAlert({
      title: "Replace with the example?",
      message: "This replaces the text in the editor. Nothing is saved until you press Save.",
      primaryAction: { title: "Replace", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    latest.current = EXAMPLE_WORKFLOW;
    setLoaded((current) => ({ text: EXAMPLE_WORKFLOW, usingExample: current?.usingExample ?? true }));
    setGeneration((n) => n + 1);
  }

  async function copy() {
    await Clipboard.copy(latest.current);
    await showToast({ style: Toast.Style.Success, title: "Workflow copied" });
  }

  const values = placeholderValues(prefs, new Date());
  const placeholderList = Object.entries(PLACEHOLDER_HELP)
    .map(([name, help]) => `{{${name}}} — ${help} (now: ${values[name]})`)
    .join("\n");

  return (
    <Form
      navigationTitle="Edit Workflow"
      isLoading={!loaded}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save" icon={Icon.Check} onSubmit={save} />
          <Action title="Replace with Example" icon={Icon.ArrowCounterClockwise} onAction={replaceWithExample} />
          <Action title="Copy Workflow" icon={Icon.Clipboard} onAction={copy} />
        </ActionPanel>
      }
    >
      {loaded && (
        <>
          <Form.Description
            text={
              loaded.usingExample
                ? "No workflow saved yet, so this is the built-in example. Paste or write your own, then Save."
                : "What Claude checks and how it judges it. It's wrapped in fixed rules: read-only, treat content as data, and the answer format."
            }
          />
          {/* Mounted only once the text has loaded: defaultValue is read on mount and ignored after. */}
          <Form.TextArea
            key={generation}
            id="workflow"
            title="Workflow"
            defaultValue={loaded.text}
            onChange={(text) => (latest.current = text)}
          />
          <Form.Description title="Placeholders" text={placeholderList} />
        </>
      )}
    </Form>
  );
}
