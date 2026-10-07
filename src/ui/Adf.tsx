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

/** The URL, normalized (so the opener's https:// check agrees), if it may be opened (https only); else null. */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Nodes, marks and code fragments left to read in one pass; the one mutable part of a pass. */
type Budget = { left: number };
type Ctx = Readonly<{ onOpen: (url: string) => void; budget: Budget }>;

/** Real text carries a handful of marks; more is junk, and nesting it would overflow the stack. */
const MAX_MARKS = 16;

/**
 * `fn` over the items of `list` while the budget lasts, charging each one just before it's handled.
 * Depth-first: a node's own content is charged before its next sibling is, so the budget runs out
 * at a point in reading order rather than starving every node of its children.
 */
function mapWithin<T, R>(list: readonly T[], budget: Budget, fn: (item: T, index: number) => R): R[] {
  const out: R[] = [];
  for (let i = 0; i < list.length && budget.left > 0; i++) {
    budget.left--;
    out.push(fn(list[i], i));
  }
  return out;
}

/** Whether `test` holds for an item of `list`, stopping at the first that does or when the budget runs out. */
function someWithin<T>(list: readonly T[], budget: Budget, test: (item: T) => boolean): boolean {
  for (let i = 0; i < list.length && budget.left > 0; i++) {
    budget.left--;
    if (test(list[i])) return true;
  }
  return false;
}

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
  // Several link marks would nest anchors (invalid, and one click would open each): keep the first.
  // (Within the first MAX_MARKS only, so a huge marks array is never read past them.)
  const capped = n.marks.slice(0, MAX_MARKS);
  const isLink = (m: unknown): boolean => asNode(m)?.type === "link";
  const safeLink = capped.findIndex((m) => isLink(m) && safeHref(str(asNode(m)?.attrs ?? {}, "href")) !== null);
  const firstLink = safeLink === -1 ? capped.findIndex(isLink) : safeLink; // a live one if there is one
  const marks = capped.filter((m, i) => !isLink(m) || i === firstLink);
  return mapWithin(marks, ctx.budget, (m) => m).reduce<ReactNode>((inner, m) => {
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
  return mapWithin(n.content, ctx.budget, (c, i) => <Fragment key={i}>{render(c, ctx, depth + 1)}</Fragment>);
}

/** A date node's calendar day. Jira stores it as UTC midnight, so it's read in UTC, not local time. */
function dateText(attrs: AdfNode["attrs"]): string {
  const raw = str(attrs, "timestamp").trim();
  if (raw === "" || Number(raw) === 0) return ""; // missing, or the unset zero
  const date = new Date(Number(raw));
  return Number.isNaN(date.getTime()) ? "" : fmtDay(date.toISOString().slice(0, 10), true); // NaN when out of range
}

function render(raw: unknown, ctx: Ctx, depth: number): ReactNode {
  const n = asNode(raw);
  if (!n || depth > MAX_DEPTH) return null; // each node was charged to the budget by `mapWithin`
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
    case "orderedList": {
      // A list can continue the numbering of an earlier one.
      const order = n.attrs.order;
      return <ol start={typeof order === "number" && Number.isInteger(order) && order > 1 ? order : undefined}>{kids()}</ol>;
    }
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
          <code>{mapWithin(n.content, ctx.budget, (c) => asNode(c)?.text ?? "").join("")}</code>
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

/** Whether an inline node with no content of its own would show anything. */
function showsSomething(n: AdfNode): boolean | undefined {
  switch (n.type) {
    case "rule":
    case "media":
    case "mediaInline":
    case "mention":
      return true;
    case "emoji":
      return (str(n.attrs, "text") || str(n.attrs, "shortName")).trim() !== "";
    case "status":
      return str(n.attrs, "text").trim() !== "";
    case "date":
      return dateText(n.attrs) !== "";
    case "inlineCard":
    case "blockCard":
    case "embedCard":
      return str(n.attrs, "url").trim() !== "";
    default:
      return undefined; // not one of these: decided by its content
  }
}

function anyContent(raw: unknown, budget: Budget, depth: number): boolean {
  const n = asNode(raw);
  if (!n || depth > MAX_DEPTH) return false;
  if (n.type === "text") return n.text.trim() !== "";
  return showsSomething(n) ?? someWithin(n.content, budget, (c) => anyContent(c, budget, depth + 1));
}

/** Whether a description has anything to show: some text, or a node that stands on its own (a rule, an image, a mention). */
export function hasContent(doc: unknown): boolean {
  return anyContent(doc, { left: MAX_NODES }, 0);
}

export function AdfDocument({ doc, onOpen }: { doc: unknown; onOpen: (url: string) => void }): ReactElement {
  return <>{render(doc, { onOpen, budget: { left: MAX_NODES } }, 0)}</>;
}
