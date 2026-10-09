import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { saveForLater } from "./lib/saved-store";

/** Save a task or note for later, with a chance to shorten the title first. */
export function SaveForLater({ title, url, onSaved }: { title: string; url: string; onSaved: () => void }) {
  const { pop } = useNavigation();

  async function save(values: { title: string }) {
    const name = values.title.trim();
    if (!name) {
      await showToast({ style: Toast.Style.Failure, title: "Give it a title" });
      return;
    }
    await saveForLater(name, url);
    await showToast({ style: Toast.Style.Success, title: "Saved for later" });
    onSaved();
    pop();
  }

  return (
    <Form
      navigationTitle="Save for Later"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save" icon={Icon.Bookmark} onSubmit={save} />
        </ActionPanel>
      }
    >
      {/* Uncontrolled, like the workflow editor: Raycast owns the text and we read it on submit. */}
      <Form.TextField id="title" title="Title" defaultValue={title} />
      {url && <Form.Description title="Link" text={url} />}
    </Form>
  );
}
