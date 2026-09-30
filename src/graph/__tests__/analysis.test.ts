import { describe, expect, it } from "vitest";
import { blockingChain, criticalPath, openBlockerCounts, readyIssues } from "../analysis";
import { buildGraph } from "../buildGraph";
import { BLOCKS, RELATES, data, issue, link, remote, site } from "./helpers";

const A = site("a");
const B = site("b");

describe("cycle detection", () => {
  it("finds a 3-issue cycle that spans two sites and marks its edges", () => {
    const [c20, c21] = [issue("CORE-20"), issue("CORE-21")];
    const p10 = issue("PAY-10");
    link("7", BLOCKS, c20, c21);
    const g = buildGraph({
      sites: [A, B],
      data: [
        data("a", [c20, c21], { "CORE-21": [remote(1, "blocks", "https://b.atlassian.net/browse/PAY-10")] }),
        data("b", [p10], { "PAY-10": [remote(2, "blocks", "https://a.atlassian.net/browse/CORE-20")] }),
      ],
    });
    expect(g.cycles).toEqual([["a:CORE-20", "a:CORE-21", "b:PAY-10"]]);
    expect(g.cycleEdgeIds.size).toBe(3);
    expect(g.brokenEdgeIds.size).toBe(1);
  });

  it("ignores relates-to loops", () => {
    const [x, y] = [issue("X-1"), issue("X-2")];
    link("1", RELATES, x, y);
    link("2", RELATES, y, x);
    const g = buildGraph({ sites: [A], data: [data("a", [x, y])] });
    expect(g.cycles).toEqual([]);
  });
});

function chain(keysAndCats: [string, "new" | "indeterminate" | "done"][]) {
  const issues = keysAndCats.map(([k, c]) => issue(k, c));
  for (let i = 0; i < issues.length - 1; i++) link(`${keysAndCats[0][0]}-${i}`, BLOCKS, issues[i], issues[i + 1]);
  return issues;
}

describe("critical path", () => {
  it("returns the longest not-Done blocks chain", () => {
    const main = chain([["M-1", "done"], ["M-2", "indeterminate"], ["M-3", "new"], ["M-4", "new"]]);
    const side = chain([["S-1", "new"], ["S-2", "new"]]);
    const g = buildGraph({ sites: [A], data: [data("a", [...main, ...side])] });
    expect(criticalPath(g).nodes).toEqual(["a:M-2", "a:M-3", "a:M-4"]);
    expect(criticalPath(g).edges).toHaveLength(2);
  });

  it("crosses sites and survives cycles", () => {
    const [x, y] = [issue("X-1"), issue("X-2")];
    link("1", BLOCKS, x, y);
    link("2", BLOCKS, y, x); // cycle
    const g = buildGraph({
      sites: [A, B],
      data: [data("a", [x, y], { "X-2": [remote(9, "blocks", "https://b.atlassian.net/browse/Z-1")] }), data("b", [issue("Z-1")])],
    });
    const p = criticalPath(g).nodes;
    expect(p).toEqual(["a:X-1", "a:X-2", "b:Z-1"]);
  });

  it("breaks ties deterministically by uid order", () => {
    const g = buildGraph({ sites: [A], data: [data("a", [...chain([["B-1", "new"], ["B-2", "new"]]), ...chain([["A-1", "new"], ["A-2", "new"]])])] });
    expect(criticalPath(g).nodes).toEqual(["a:A-1", "a:A-2"]);
  });

  it("excludes ghosts", () => {
    const [x, y] = [issue("X-1"), issue("X-2")];
    link("1", BLOCKS, x, y, { out: false, in: true });
    const g = buildGraph({ sites: [A], data: [data("a", [y])] });
    expect(criticalPath(g).nodes).toEqual([]);
  });
});

describe("what's ready and open blockers", () => {
  it("treats Done blockers as closed and unknown ghosts as open", () => {
    const done = issue("D-1", "done");
    const readyOne = issue("R-1");
    link("1", BLOCKS, done, readyOne);
    const blocked = issue("B-1");
    const g = buildGraph({
      sites: [A],
      data: [data("a", [done, readyOne, blocked, issue("F-1", "indeterminate")], {
        "B-1": [remote(1, "is blocked by", "https://elsewhere.atlassian.net/browse/Q-1")],
      })],
    });
    const ready = readyIssues(g);
    expect([...ready].sort()).toEqual(["a:F-1", "a:R-1"]);
    expect(openBlockerCounts(g).get("a:B-1")).toBe(1);
    expect(openBlockerCounts(g).get("a:R-1")).toBeUndefined();
  });

  it("counts distinct open blockers", () => {
    const target = issue("T-1");
    const bs = ["B-1", "B-2", "B-3"].map((k) => issue(k));
    bs.forEach((b, i) => link(String(i), BLOCKS, b, target));
    const g = buildGraph({ sites: [A], data: [data("a", [target, ...bs])] });
    expect(openBlockerCounts(g).get("a:T-1")).toBe(3);
  });
});

describe("blocking chain (hover)", () => {
  it("collects ancestors and descendants across sites, but not relates", () => {
    const [x, y, r] = [issue("X-1"), issue("X-2"), issue("X-9")];
    link("1", BLOCKS, x, y);
    link("2", RELATES, y, r);
    const g = buildGraph({
      sites: [A, B],
      data: [data("a", [x, y, r], { "X-2": [remote(1, "blocks", "https://b.atlassian.net/browse/Z-1")] }), data("b", [issue("Z-1")])],
    });
    expect([...blockingChain(g, "a:X-2").nodes].sort()).toEqual(["a:X-1", "a:X-2", "b:Z-1"]);
  });
});
