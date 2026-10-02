import { describe, expect, it } from "vitest";
import { defined } from "../../lib/guards";
import type { RawIssue } from "../../data/jiraTypes";
import { buildGraph } from "../buildGraph";
import { BLOCKS, data, issue, link, site } from "./helpers";

const A = site("a");
const B = site("b");

function typed(key: string, type: string, hierarchyLevel?: number): RawIssue {
  const i = issue(key);
  i.fields.issuetype = { name: type, hierarchyLevel };
  return i;
}

function withParent(child: RawIssue, parent: RawIssue): RawIssue {
  child.fields.parent = {
    id: parent.id,
    key: parent.key,
    fields: { summary: parent.fields.summary, status: parent.fields.status, issuetype: parent.fields.issuetype },
  };
  return child;
}

const epicOf = (g: ReturnType<typeof buildGraph>, uid: string): string | undefined => g.nodes.find((n) => n.uid === uid)?.epic?.uid;

describe("epic assignment", () => {
  it("uses the parent when it is an epic, and an epic points at itself", () => {
    const epic = typed("E-1", "Epic", 1);
    const story = withParent(typed("S-1", "Story", 0), epic);
    const g = buildGraph({ sites: [A], data: [data("a", [epic, story])] });
    expect(epicOf(g, "a:S-1")).toBe("a:E-1");
    expect(epicOf(g, "a:E-1")).toBe("a:E-1");
    expect(defined(g.nodes.find((n) => n.uid === "a:S-1"), "node").epic).toMatchObject({ key: "E-1", summary: "Summary of E-1", url: "https://a.atlassian.net/browse/E-1" });
  });

  it("recognizes epics by name when hierarchyLevel is missing", () => {
    const story = withParent(typed("S-1", "Story"), typed("E-1", "Epic"));
    const g = buildGraph({ sites: [A], data: [data("a", [story])] });
    expect(epicOf(g, "a:S-1")).toBe("a:E-1");
  });

  it("gives a sub-task its story's epic when the story is loaded, and none otherwise", () => {
    const epic = typed("E-1", "Epic", 1);
    const story = withParent(typed("S-1", "Story", 0), epic);
    const sub = withParent(typed("S-2", "Sub-task", -1), story);
    const orphan = withParent(typed("S-3", "Sub-task", -1), typed("S-9", "Story", 0));
    const g = buildGraph({ sites: [A], data: [data("a", [sub, story, orphan])] });
    expect(epicOf(g, "a:S-2")).toBe("a:E-1");
    expect(epicOf(g, "a:S-3")).toBeUndefined();
  });

  it("falls back to the legacy Epic Link field and fills its summary when the epic is loaded", () => {
    const story = typed("S-1", "Story", 0);
    story.fields.customfield_10014 = "E-7";
    const epic = typed("E-7", "Epic", 1);
    epic.fields.summary = "Legacy epic";
    const g = buildGraph({ sites: [A], data: [data("a", [story, epic])] });
    expect(defined(g.nodes.find((n) => n.uid === "a:S-1"), "node").epic).toMatchObject({ uid: "a:E-7", summary: "Legacy epic" });
  });

  it("keeps same-key epics on two sites apart", () => {
    const g = buildGraph({
      sites: [A, B],
      data: [
        data("a", [withParent(typed("S-1", "Story", 0), typed("E-1", "Epic", 1))]),
        data("b", [withParent(typed("S-1", "Story", 0), typed("E-1", "Epic", 1))]),
      ],
    });
    expect(epicOf(g, "a:S-1")).toBe("a:E-1");
    expect(epicOf(g, "b:S-1")).toBe("b:E-1");
  });

  it("leaves ghosts without an epic", () => {
    const [x, y] = [issue("X-1"), issue("X-2")];
    link("1", BLOCKS, x, y, { out: false, in: true });
    const g = buildGraph({ sites: [A], data: [data("a", [y])] });
    expect(defined(g.nodes.find((n) => n.ghost), "node").epic).toBeUndefined();
  });
});
