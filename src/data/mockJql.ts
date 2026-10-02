// The JQL subset the mock backends understand. Kept in sync with src-tauri/src/jira/mock.rs.
//   Evaluated: project, key, parent (= / in), statusCategory (= / != / in / not in), issueLinkType (= / in)
//   Accepted but ignored (fixtures have no such data): updated, created, sprint, assignee, reporter
//   Clauses are joined by AND (parentheses allowed); OR is not supported. ORDER BY is ignored.
import type { RawIssue } from "./jiraTypes";

type Field = "project" | "key" | "parent" | "statuscategory" | "issuelinktype";
type MockClause = { field: Field; negate: boolean; values: string[] } | { field: "ignored" };

const EVALUATED: ReadonlySet<string> = new Set<Field>(["project", "key", "parent", "statuscategory", "issuelinktype"]);
const isEvaluated = (f: string): f is Field => EVALUATED.has(f);
const IGNORED = new Set(["updated", "created", "sprint", "assignee", "reporter"]);

/** Splits on AND at paren depth 0 (outside quotes); unwraps fully parenthesized groups. */
export function splitTopLevelAnd(input: string): string[] {
  let s = input.replace(/\s+/g, " ").trim();
  while (s.startsWith("(") && closingParen(s, 0) === s.length - 1) s = s.slice(1, -1).trim();
  const parts: string[] = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quote = !quote;
    else if (!quote && c === "(") depth++;
    else if (!quote && c === ")") depth--;
    else if (!quote && depth === 0 && s.slice(i, i + 5).toLowerCase() === " and ") {
      parts.push(s.slice(start, i));
      start = i + 5;
      i += 4;
    }
  }
  parts.push(s.slice(start));
  return parts.flatMap((p) => {
    const t = p.trim();
    return t.startsWith("(") && closingParen(t, 0) === t.length - 1 ? splitTopLevelAnd(t) : [t];
  });
}

function closingParen(s: string, open: number): number {
  let depth = 0;
  let quote = false;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '"') quote = !quote;
    else if (!quote && s[i] === "(") depth++;
    else if (!quote && s[i] === ")" && --depth === 0) return i;
  }
  return -1;
}

export function parseMockJql(jql: string): MockClause[] {
  const body = jql.replace(/\s+order\s+by\s+[\s\S]*$/i, "").trim();
  if (!body) return [];
  if (/\s(or)\s/i.test(body.replace(/"[^"]*"/g, '""'))) throw new Error("Mock backend doesn't support OR");
  return splitTopLevelAnd(body).map((raw) => {
    const m = /^(\w+)\s*(not in|in|!=|>=|<=|=|>|<|is not|is|~)\s*([\s\S]+)$/i.exec(raw);
    const field = m?.[1].toLowerCase();
    if (!m || !field || !(isEvaluated(field) || IGNORED.has(field))) {
      throw new Error(`Mock backend can't evaluate "${raw}" (supports project, key, parent, statusCategory, issueLinkType)`);
    }
    if (!isEvaluated(field)) return { field: "ignored" };
    const op = m[2].toLowerCase();
    if (!["=", "!=", "in", "not in"].includes(op)) throw new Error(`Mock backend can't evaluate "${raw}"`);
    const list = op.endsWith("in") ? m[3].trim().replace(/^\(|\)$/g, "") : m[3];
    return {
      field,
      negate: op === "!=" || op === "not in",
      values: list.split(",").map((v) => v.trim().replace(/^"|"$/g, "").toLowerCase()).filter(Boolean),
    };
  });
}

export function matchesMockJql(issue: RawIssue, clauses: readonly MockClause[]): boolean {
  return clauses.every((c) => {
    if (c.field === "ignored") return true;
    let actual: string[];
    switch (c.field) {
      case "project":
        actual = [issue.key.split("-")[0]];
        break;
      case "key":
        actual = [issue.key];
        break;
      case "parent":
        actual = [issue.fields.parent?.key ?? ""];
        break;
      case "statuscategory": {
        const cat = issue.fields.status?.statusCategory;
        actual = cat ? [cat.name, cat.key] : [];
        break;
      }
      case "issuelinktype":
        // Jira matches the directional description ("blocks" / "is blocked by"), not the type name.
        actual = (issue.fields.issuelinks ?? []).map((l) => (l.outwardIssue ? l.type.outward : l.type.inward));
        break;
    }
    const hit = actual.some((a) => c.values.includes(a.toLowerCase()));
    return c.negate ? !hit : hit;
  });
}
