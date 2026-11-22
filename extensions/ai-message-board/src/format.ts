// Text for the menu and the screens. No Raycast imports here, so it runs under plain Node too.
import type { Comment, Decision, HumanTask } from "./board";

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/**
 * Markdown as one line of plain text, for menu titles, tooltips and dropdowns.
 * Emphasis marks go only where they wrap text, so STRIPE_KEY and 2*3 stay as they are.
 */
export function plain(markdown: string, max = Infinity): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|~~)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(\S(?:.*?\S)?)\*(?![\w*])/g, "$1$2")
    .replace(/(^|\W)_(\S(?:.*?\S)?)_(?!\w)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function linksMarkdown(links: string[]): string {
  return links.length > 0 ? `\n\n## Links\n\n${links.map((l) => `- ${l}`).join("\n")}` : "";
}

function commentsMarkdown(comments: Comment[], now: number): string {
  if (comments.length === 0) return "";
  const lines = comments.map((c) => `**${c.from}** · ${ago(c.at, now)}\n\n${c.content}`);
  return `\n\n## Discussion\n\n${lines.join("\n\n---\n\n")}`;
}

const DECISION_STATUS: Record<Decision["status"], string> = {
  open: "Waiting for you",
  answered: "Answered",
  withdrawn: "Withdrawn",
  superseded: "Superseded",
};

/** The whole decision, as the board's Decisions tab shows it. */
export function decisionMarkdown(d: Decision, now = Date.now()): string {
  const status = DECISION_STATUS[d.status];
  const head = `# D-${d.id} · ${plain(d.question)}\n\n**${status}** · #${d.channel} · asked by **${d.askedBy}** · ${ago(d.createdAt, now)}`;
  const context = d.context ? `\n\n${d.context}` : "";
  const options = d.options
    .map((o, i) => {
      const recommended = i === d.recommended ? " · *recommended*" : "";
      const chosen = d.answer?.option === i ? " · ✓ **your answer**" : "";
      return `**${i + 1}. ${plain(o.label)}**${recommended}${chosen}${o.detail ? `\n\n${o.detail}` : ""}`;
    })
    .join("\n\n");
  let outcome = "";
  if (d.answer) {
    const what = d.answer.option === null ? d.answer.other : (d.options[d.answer.option]?.label ?? "");
    outcome = `\n\n## Your answer\n\n${what}${d.answer.note ? `\n\n${d.answer.note}` : ""}`;
  } else if (d.withdrawn) {
    outcome = `\n\n## Withdrawn by ${d.withdrawn.by}${d.withdrawn.reason ? `\n\n${d.withdrawn.reason}` : ""}`;
  }
  return `${head}${context}\n\n## Options\n\n${options}${outcome}${linksMarkdown(d.links)}${commentsMarkdown(d.comments, now)}`;
}

const HUMAN_TASK_STATUS: Record<HumanTask["status"], string> = {
  open: "Waiting for you",
  done: "Done",
  declined: "Can't do",
  withdrawn: "Withdrawn",
};

/** The whole human task, as the board's Human Tasks tab shows it. */
export function humanTaskMarkdown(t: HumanTask, now = Date.now()): string {
  const status = HUMAN_TASK_STATUS[t.status];
  const head = `# H-${t.id} · ${plain(t.title)}\n\n**${status}** · #${t.channel} · asked by **${t.requestedBy}** · ${ago(t.createdAt, now)}`;
  const details = t.details ? `\n\n${t.details}` : "";
  let outcome = "";
  if (t.resolution?.note) outcome = `\n\n## Your note\n\n${t.resolution.note}`;
  else if (t.withdrawn) {
    outcome = `\n\n## Withdrawn by ${t.withdrawn.by}${t.withdrawn.reason ? `\n\n${t.withdrawn.reason}` : ""}`;
  }
  return `${head}${details}${outcome}${linksMarkdown(t.links)}${commentsMarkdown(t.comments, now)}`;
}
