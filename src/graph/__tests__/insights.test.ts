import { describe, expect, it } from "vitest";
import { defined, getOrThrow } from "../../lib/guards";
import { buildGraph } from "../buildGraph";
import type { RawIssue } from "../../data/jiraTypes";
import { computeInsights, downstreamOpen, emphasis } from "../insights";
import { laneByAssignee } from "../layout";
import type { Graph } from "../types";
import { BLOCKS, data, issue, link, remote, site } from "./helpers";

const A = site("a");

function sample(): Graph {
  const [done, open, blocked, ready] = [issue("D-1", "done"), issue("O-1", "indeterminate"), issue("B-1"), issue("R-1")];
  link("1", BLOCKS, done, ready); // done blocker: R-1 is ready
  link("2", BLOCKS, open, blocked); // open blocker: B-1 is blocked
  return buildGraph({ sites: [A], data: [data("a", [done, open, blocked, ready])] });
}

describe("computeInsights", () => {
  it("splits open work into blocked and ready", () => {
    const i = computeInsights(sample());
    expect([...i.blocked]).toEqual(["a:B-1"]);
    expect([...i.ready].sort()).toEqual(["a:O-1", "a:R-1"]);
    expect(i.critical.nodes).toEqual(["a:O-1", "a:B-1"]);
    expect(i.cycleCount).toBe(0);
  });

  it("emphasis returns the highlighted set, or null for none", () => {
    const i = computeInsights(sample());
    expect(emphasis("none", i)).toBeNull();
    expect([...defined(emphasis("blocked", i), "emphasis").nodes]).toEqual(["a:B-1"]);
    expect([...defined(emphasis("critical", i), "emphasis").edges]).toEqual(["a:link:2"]);
  });

  it("a scoped highlight keeps only the user's issues, and critical links between two of them", () => {
    const base = computeInsights(sample());
    const mineOnly = (assigned: string[]): typeof base => ({ ...base, mine: { assigned: new Set(assigned), reported: new Set() } });
    expect([...defined(emphasis("ready", mineOnly(["a:R-1"]), "assigned"), "ready").nodes]).toEqual(["a:R-1"]);
    expect([...defined(emphasis("blocked", mineOnly(["a:R-1"]), "assigned"), "blocked").nodes]).toEqual([]);
    const oneEnd = defined(emphasis("critical", mineOnly(["a:B-1"]), "assigned"), "critical, one end");
    expect([[...oneEnd.nodes], [...oneEnd.edges]]).toEqual([["a:B-1"], []]);
    const bothEnds = defined(emphasis("critical", mineOnly(["a:O-1", "a:B-1"]), "assigned"), "critical, both ends");
    expect([...bothEnds.edges]).toEqual(["a:link:2"]);
    expect(emphasis("none", mineOnly(["a:R-1"]), "assigned")).toBeNull();
  });
});


const B = site("b");
const owned = (key: string, who: string | null, cat: "new" | "indeterminate" | "done" = "new"): RawIssue => {
  const i = issue(key, cat);
  i.fields.assignee = who ? { displayName: who } : null;
  return i;
};

describe("unblock impact", () => {
  // X-1 -> X-2 -> X-3 (done) -> X-4, and X-2 =(remote)=> b:Y-1
  function chain(): Graph {
    const [x1, x2, x3, x4] = [owned("X-1", "Ana"), owned("X-2", "Ana"), owned("X-3", "Bo", "done"), owned("X-4", "Cy")];
    link("1", BLOCKS, x1, x2);
    link("2", BLOCKS, x2, x3);
    link("3", BLOCKS, x3, x4);
    return buildGraph({
      sites: [A, B],
      data: [data("a", [x1, x2, x3, x4], { "X-2": [remote(9, "blocks", "https://b.atlassian.net/browse/Y-1")] }), data("b", [owned("Y-1", "Dee")])],
    });
  }

  it("counts distinct open work downstream, through done issues and across sites", () => {
    const d = downstreamOpen(chain());
    expect([...getOrThrow(d, "a:X-1")].sort()).toEqual(["a:X-2", "a:X-4", "b:Y-1"]); // X-3 is done: passed through, not counted
    expect(d.has("a:X-3")).toBe(false); // done issues aren't unblockers
  });

  it("ranks the biggest unblockers first, with the sites they reach", () => {
    const top = computeInsights(chain()).unblockers;
    expect(top[0]).toEqual({ uid: "a:X-1", downstream: 3, sites: 2 });
    expect(top.map((u) => u.uid)).toEqual(["a:X-1", "a:X-2"]);
  });

  it("terminates on cycles and never counts an issue as its own dependent", () => {
    const [p, q] = [owned("P-1", "Ana"), owned("P-2", "Bo")];
    link("1", BLOCKS, p, q);
    link("2", BLOCKS, q, p);
    const d = downstreamOpen(buildGraph({ sites: [A], data: [data("a", [p, q])] }));
    expect([...getOrThrow(d, "a:P-1")]).toEqual(["a:P-2"]);
  });

  it("holding up counts only other people's open issues", () => {
    const h = computeInsights(chain()).holdingUpByAssignee;
    expect(h.get("Ana")).toBe(2); // X-4 (Cy) and Y-1 (Dee); X-2 is Ana's own
    expect(h.has("Cy")).toBe(false);
  });
});

describe("laneByAssignee", () => {
  it("labels lanes with holding-up counts and puts unassigned and ghosts last", () => {
    const g = buildGraph({ sites: [A], data: [data("a", [owned("Z-1", "Ana"), owned("Z-2", null)])] });
    const lane = laneByAssignee(new Map([["Ana", 3]]));
    expect(lane(defined(g.nodes.find((n) => n.key === "Z-1"), "node"))).toEqual({ id: "assignee:Ana", label: "Ana · holding up 3" });
    expect(lane(defined(g.nodes.find((n) => n.key === "Z-2"), "node"))).toMatchObject({ label: "Unassigned", last: true });
  });
});
