import { Fragment, type ReactElement, type ReactNode } from "react";
import { fmtDay } from "./format";

// Renders a Jira description (Atlassian Document Format) as React elements. It never builds HTML
// from strings: text is always a text node, and only https links are live (the same rule as
// `openExternal`). Jira's JSON is untrusted, so every field is checked before use.

type AdfNode = Readonly<{
  type: string;
  content: readonly unknown[];
  text: string;
  marks: readonly unknown[];
  attrs: Readonly<Record<string, unknown>>;
}>;

/** Deeper than any real description; past it, content is dropped rather than overflowing the stack. */
const MAX_DEPTH = 64;
/** Far more nodes than any real description; past it, the rest is dropped rather than freezing the panel. */
const MAX_NODES = 20_000;
const PANEL_TYPES = new Set(["info", "note", "warning", "success", "error"]);

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === "object" && v !== null && !Array.isArray(v);

function asNode(v: unknown): AdfNode | null {
  if (!isRecord(v) || typeof v.type !== "string") return null;
  return {
    type: v.type,
    content: Array.isArray(v.content) ? v.content : [],
    text: typeof v.text === "string" ? v.text : "",
    marks: Array.isArray(v.marks) ? v.marks : [],
    attrs: isRecord(v.attrs) ? v.attrs : {},
  };
}

const str = (attrs: AdfNode["attrs"], name: string): string => {
  const v = attrs[name];
  return typeof v === "string" ? v : "";
};

/** The URL if it may be opened (https only), else null. */
export function safeHref(url: string): string | null {
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** `budget` is the one mutable part: nodes left to render, shared by a single render pass. */
type Ctx = Readonly<{ onOpen: (url: string) => void; budget: { left: number } }>;

function Link({ href, children, ctx }: { href: string; children: ReactNode; ctx: Ctx }): ReactElement {
  const safe = safeHref(href);
  if (!safe) return <>{children}</>;
  return (
    <a
      href={safe}
      title={safe}
      onClick={(e) => {
        e.preventDefault();
        ctx.onOpen(safe);
      }}
      // A middle click would otherwise go to the webview instead of the system browser.
      onAuxClick={(e) => {
        e.preventDefault();
        if (e.button === 1) ctx.onOpen(safe);
      }}
    >
      {children}
    </a>
  );
}

/** Wraps text in its marks, innermost first. */
function marked(n: AdfNode, ctx: Ctx): ReactNode {
  return n.marks.reduce<ReactNode>((inner, m) => {
    const mark = asNode(m);
    switch (mark?.type) {
      case "strong":
        return <strong>{inner}</strong>;
      case "em":
        return <em>{inner}</em>;
      case "code":
        return <code>{inner}</code>;
      case "strike":
        return <s>{inner}</s>;
      case "underline":
        return <u>{inner}</u>;
      case "subsup":
        return str(mark.attrs, "type") === "sup" ? <sup>{inner}</sup> : <sub>{inner}</sub>;
      case "link":
        return (
          <Link href={str(mark.attrs, "href")} ctx={ctx}>
            {inner}
          </Link>
        );
      default:
        return inner;
    }
  }, n.text);
}

function children(n: AdfNode, ctx: Ctx, depth: number): ReactNode {
  return n.content.map((c, i) => <Fragment key={i}>{render(c, ctx, depth + 1)}</Fragment>);
}

/** A date node's calendar day. Jira stores it as UTC midnight, so it's read in UTC, not local time. */
function dateText(attrs: AdfNode["attrs"]): string {
  const date = new Date(Number(str(attrs, "timestamp")));
  return Number.isNaN(date.getTime()) ? "" : fmtDay(date.toISOString().slice(0, 10), true);
}

function render(raw: unknown, ctx: Ctx, depth: number): ReactNode {
  const n = asNode(raw);
  if (!n || depth > MAX_DEPTH || ctx.budget.left <= 0) return null;
  ctx.budget.left--;
  const kids = (): ReactNode => children(n, ctx, depth);
  switch (n.type) {
    case "doc":
      return kids();
    case "paragraph":
      return <p>{kids()}</p>;
    case "text":
      return marked(n, ctx);
    case "hardBreak":
      return <br />;
    case "heading": {
      // The panel uses h2 and h3; description headings sit below them.
      const level = Number(n.attrs.level);
      if (level >= 6) return <h6>{kids()}</h6>;
      if (level === 5) return <h5>{kids()}</h5>;
      return <h4>{kids()}</h4>;
    }
    case "bulletList":
      return <ul>{kids()}</ul>;
    case "orderedList":
      return <ol>{kids()}</ol>;
    case "listItem":
      return <li>{kids()}</li>;
    case "taskList":
    case "decisionList":
      return <ul className="adf-tasks">{kids()}</ul>;
    case "taskItem": {
      const done = str(n.attrs, "state") === "DONE";
      return (
        <li>
          <span role="checkbox" aria-checked={done} aria-disabled="true" className="adf-check">
            {done ? "☑" : "☐"}
          </span>{" "}
          {kids()}
        </li>
      );
    }
    case "decisionItem":
      return <li>◆ {kids()}</li>;
    case "codeBlock":
      return (
        <pre>
          <code>{n.content.map((c) => asNode(c)?.text ?? "").join("")}</code>
        </pre>
      );
    case "blockquote":
      return <blockquote>{kids()}</blockquote>;
    case "rule":
      return <hr />;
    case "panel": {
      const panelType = str(n.attrs, "panelType");
      return <div className={`adf-panel adf-panel-${PANEL_TYPES.has(panelType) ? panelType : "info"}`}>{kids()}</div>;
    }
    case "expand":
    case "nestedExpand":
      return (
        <details className="adf-expand">
          <summary>{str(n.attrs, "title") || "Details"}</summary>
          {kids()}
        </details>
      );
    case "table":
      return (
        <div className="adf-table">
          <table>
            <tbody>{kids()}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr>{kids()}</tr>;
    case "tableHeader":
      return <th>{kids()}</th>;
    case "tableCell":
      return <td>{kids()}</td>;
    case "mention":
      return <span className="adf-mention">{str(n.attrs, "text") || "@someone"}</span>;
    case "emoji":
      return str(n.attrs, "text") || str(n.attrs, "shortName");
    case "status":
      return <span className="adf-status">{str(n.attrs, "text")}</span>;
    case "date":
      return <time>{dateText(n.attrs)}</time>;
    case "inlineCard":
    case "blockCard":
    case "embedCard": {
      const url = str(n.attrs, "url");
      return url ? (
        <Link href={url} ctx={ctx}>
          {url}
        </Link>
      ) : null;
    }
    case "mediaSingle":
    case "mediaGroup":
      return <p className="adf-media">{kids()}</p>;
    case "media":
    case "mediaInline":
      // Jira serves media only to a signed-in browser session.
      return <span className="adf-media-item">Image or attachment (open in Jira to view)</span>;
    default:
      // Unknown block or inline: keep whatever it contains.
      return kids();
  }
}

/** Nodes that show something without any text inside them. */
const SELF_CONTAINED = new Set([
  "rule",
  "media",
  "mediaInline",
  "mention",
  "emoji",
  "status",
  "date",
  "inlineCard",
  "blockCard",
  "embedCard",
]);

/** Whether a description has anything to show: some text, or a node that stands on its own (a rule, an image, a mention). */
export function hasContent(doc: unknown, depth = 0): boolean {
  const n = asNode(doc);
  if (!n || depth > MAX_DEPTH) return false;
  if (n.type === "text") return n.text.trim() !== "";
  if (SELF_CONTAINED.has(n.type)) return true;
  return n.content.some((c) => hasContent(c, depth + 1));
}

export function AdfDocument({ doc, onOpen }: { doc: unknown; onOpen: (url: string) => void }): ReactElement {
  return <>{render(doc, { onOpen, budget: { left: MAX_NODES } }, 0)}</>;
}
