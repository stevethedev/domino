import { describe, expect, it } from "vitest";
import type { RawIssue } from "../../data/jiraTypes";
import { buildGraph } from "../buildGraph";
import { myIssues } from "../mine";
import { BLOCKS, data, issue, link, site } from "./helpers";

const as = (i: RawIssue, assignee: string | null, reporter: string): RawIssue => ({
  ...i,
  fields: { ...i.fields, assignee: assignee ? { accountId: assignee, displayName: assignee } : null, reporter: { accountId: reporter, displayName: reporter } },
});

describe("myIssues", () => {
  const a1 = as(issue("A-1"), "me", "pm");
  const a2 = as(issue("A-2"), "someone", "me");
  const b1 = as(issue("B-1"), "me", "me");
  const outside = issue("A-9");
  link("1", BLOCKS, a1, outside, { out: true, in: false }); // A-9 is a ghost: never "mine"
  const graph = buildGraph({ sites: [site("a"), site("b")], data: [data("a", [a1, a2]), data("b", [b1])] });

  it("matches assignee and reporter against the user's account on each issue's own site", () => {
    // On site b the user is someone else, so B-1 (assigned to/reported by "me") isn't theirs there.
    const mine = myIssues(graph.nodes, new Map([["a", "me"], ["b", "other-account"]]));
    expect([...mine.assigned]).toEqual(["a:A-1"]);
    expect([...mine.reported]).toEqual(["a:A-2"]);
  });

  it("counts nothing on sites where the user is unknown", () => {
    const mine = myIssues(graph.nodes, new Map([["b", "me"]]));
    expect([...mine.assigned, ...mine.reported]).toEqual(["b:B-1", "b:B-1"]);
  });
});
