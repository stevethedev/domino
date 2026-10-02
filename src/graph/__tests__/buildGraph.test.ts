import { describe, expect, it } from "vitest";
import type { RawIssue } from "../../data/jiraTypes";
import { defined } from "../../lib/guards";
import { buildGraph } from "../buildGraph";
import { matchRemoteUrl } from "../remoteUrl";
import { resolveRelationship } from "../linkTypes";
import { BLOCKS, DUPLICATE, RELATES, data, issue, link, remote, site } from "./helpers";

const A = site("a");
const B = site("b");

describe("uid identity", () => {
  it("keeps the same key on two sites as two distinct nodes", () => {
    const g = buildGraph({ sites: [A, B], data: [data("a", [issue("CORE-7")]), data("b", [issue("CORE-7", "done")])] });
    expect(g.nodes.map((n) => n.uid).sort()).toEqual(["a:CORE-7", "b:CORE-7"]);
    expect(defined(g.nodes.find((n) => n.uid === "b:CORE-7"), "node").statusCategory).toBe("done");
  });

  it("does not connect same-key issues across sites via native links", () => {
    const a7 = issue("CORE-7");
    const a8 = issue("CORE-8");
    link("1", BLOCKS, a7, a8);
    const g = buildGraph({ sites: [A, B], data: [data("a", [a7, a8]), data("b", [issue("CORE-7")])] });
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ source: "a:CORE-7", target: "a:CORE-8", crossSite: false });
  });
});

describe("direction normalization and dedup", () => {
  it("turns both sides of a native link into exactly one outward edge", () => {
    const x = issue("X-1");
    const y = issue("X-2");
    link("100", BLOCKS, x, y); // X-1 blocks X-2
    const g = buildGraph({ sites: [A], data: [data("a", [y, x])] }); // order must not matter
    expect(g.edges).toEqual([
      expect.objectContaining({ source: "a:X-1", target: "a:X-2", kind: "blocks", linkType: "blocks", linkId: "100" }),
    ]);
  });

  it("normalizes when only the inward side is loaded", () => {
    const x = issue("X-1");
    const y = issue("X-2");
    link("100", BLOCKS, x, y, { out: false, in: true });
    const g = buildGraph({ sites: [A], data: [data("a", [y])] });
    expect(g.edges[0]).toMatchObject({ source: "a:X-1", target: "a:X-2" });
    expect(defined(g.nodes.find((n) => n.uid === "a:X-1"), "node").ghost).toBe(true);
  });

  it("dedups by siteId + linkId, so equal link ids on two sites stay separate", () => {
    const [a1, a2, b1, b2] = [issue("P-1"), issue("P-2"), issue("P-1"), issue("P-2")];
    link("10001", BLOCKS, a1, a2);
    link("10001", BLOCKS, b1, b2);
    const g = buildGraph({ sites: [A, B], data: [data("a", [a1, a2]), data("b", [b1, b2])] });
    expect(g.edges.map((e) => e.id).sort()).toEqual(["a:link:10001", "b:link:10001"]);
  });

  it("maps duplicates and clones to the duplicates kind and relates to relates", () => {
    const [p, q, r] = [issue("P-1"), issue("P-2"), issue("P-3")];
    link("1", DUPLICATE, p, q);
    link("2", RELATES, q, r);
    const g = buildGraph({ sites: [A], data: [data("a", [p, q, r])] });
    expect(g.edges.map((e) => [e.linkId, e.kind]).sort()).toEqual([
      ["1", "duplicates"],
      ["2", "relates"],
    ]);
  });
});

describe("remote links", () => {
  it("creates one cross-site edge from reciprocal remote links", () => {
    const pay3 = issue("PAY-3");
    const core10 = issue("CORE-10");
    const g = buildGraph({
      sites: [A, B],
      data: [
        data("b", [pay3], { "PAY-3": [remote(1, "blocks", "https://a.atlassian.net/browse/CORE-10")] }),
        data("a", [core10], { "CORE-10": [remote(2, "is blocked by", "https://b.atlassian.net/browse/PAY-3")] }),
      ],
    });
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ source: "b:PAY-3", target: "a:CORE-10", kind: "blocks", crossSite: true });
    expect(g.nodes.every((n) => !n.ghost)).toBe(true);
  });

  it("falls back to relates to for unknown relationships", () => {
    const g = buildGraph({
      sites: [A, B],
      data: [data("a", [issue("A-1")], { "A-1": [remote(1, "discussed with", "https://b.atlassian.net/browse/B-1")] }), data("b", [issue("B-1")])],
    });
    expect(g.edges[0]).toMatchObject({ kind: "relates", linkType: "relates to", crossSite: true });
  });

  it("makes a ghost for a configured site that isn't loaded (e.g. disabled)", () => {
    const legacy = site("legacy", false);
    const g = buildGraph({
      sites: [A, legacy],
      data: [data("a", [issue("WEB-2")], { "WEB-2": [remote(1, "is blocked by", "https://legacy.atlassian.net/browse/LEG-4")] })],
    });
    const ghost = defined(g.nodes.find((n) => n.uid === "legacy:LEG-4"), "node");
    expect(ghost).toMatchObject({ ghost: true, siteLabel: "LEGACY", statusCategory: "unknown" });
    expect(g.edges[0]).toMatchObject({ source: "legacy:LEG-4", target: "a:WEB-2", crossSite: true });
  });

  it("makes a host-labelled ghost for an unconfigured Jira site and ignores non-Jira URLs", () => {
    const g = buildGraph({
      sites: [A],
      data: [
        data("a", [issue("A-1")], {
          "A-1": [
            remote(1, "is blocked by", "https://other.atlassian.net/browse/EXT-9"),
            remote(2, "mentioned in", "https://github.com/org/repo/pull/1"),
          ],
        }),
      ],
    });
    expect(g.nodes.map((n) => n.uid).sort()).toEqual(["a:A-1", "other.atlassian.net:EXT-9"]);
    expect(defined(g.nodes.find((n) => n.ghost), "node")).toMatchObject({ siteLabel: "other.atlassian.net", url: "https://other.atlassian.net/browse/EXT-9" });
    expect(g.edges).toHaveLength(1);
  });

  it("matchRemoteUrl is case-insensitive on host and tolerant of a trailing slash", () => {
    expect(matchRemoteUrl("https://A.atlassian.net/browse/core-10/", [A])).toEqual({ kind: "site", siteId: "a", key: "CORE-10" });
    expect(matchRemoteUrl("https://a.atlassian.net/wiki/spaces/X", [A])).toBeNull();
    expect(matchRemoteUrl("not a url", [A])).toBeNull();
  });

  it("resolveRelationship handles inward phrasing", () => {
    expect(resolveRelationship("Is Blocked By", [])).toMatchObject({ kind: "blocks", inward: true });
    expect(resolveRelationship("is cloned by", [])).toMatchObject({ kind: "duplicates", linkType: "clones", inward: true });
    expect(resolveRelationship(undefined, [])).toMatchObject({ kind: "relates" });
  });
});

describe("ghosts", () => {
  it("uses the status embedded in issuelinks for out-of-scope native links", () => {
    const ops = issue("OPS-3", "indeterminate");
    const web = issue("WEB-2");
    link("5", BLOCKS, ops, web);
    const g = buildGraph({ sites: [A], data: [data("a", [web])] });
    expect(g.nodes.find((n) => n.uid === "a:OPS-3")).toMatchObject({ ghost: true, statusCategory: "inprogress" });
  });

  it("prefers the loaded issue over a ghost reference", () => {
    const x = issue("X-1");
    const y = issue("X-2");
    link("1", BLOCKS, x, y);
    const g = buildGraph({ sites: [A], data: [data("a", [x, y])] });
    expect(g.nodes.filter((n) => n.ghost)).toEqual([]);
  });
});

describe("partial Jira data", () => {
  // Jira JSON reaches buildGraph unvalidated; restricted or partially returned issues can omit these.
  const withoutStatusAndType = (key: string): RawIssue => {
    const loaded = issue(key);
    const { status: _status, issuetype: _type, ...fields } = loaded.fields;
    return { ...loaded, fields };
  };

  it("falls back when Jira omits status or issue type, on loaded and linked (ghost) issues", () => {
    const [loaded, outside] = [withoutStatusAndType("CORE-1"), withoutStatusAndType("CORE-2")];
    link("1", BLOCKS, loaded, outside, { out: true, in: false });
    const g = buildGraph({ sites: [A], data: [data("a", [loaded])] });
    for (const [key, ghost] of [["CORE-1", false], ["CORE-2", true]] as const) {
      const n = defined(g.nodes.find((x) => x.key === key), key);
      expect([n.ghost, n.issueType, n.statusName, n.statusCategory], key).toEqual([ghost, "Issue", "Unknown", "unknown"]);
    }
  });

  it("treats a status without a category as unknown instead of failing the whole graph", () => {
    const loaded = issue("CORE-1");
    const g = buildGraph({ sites: [A], data: [data("a", [{ ...loaded, fields: { ...loaded.fields, status: { name: "Open" } } }])] });
    const n = defined(g.nodes.find((x) => x.key === "CORE-1"), "CORE-1");
    expect([n.statusName, n.statusCategory]).toEqual(["Open", "unknown"]);
  });
});
