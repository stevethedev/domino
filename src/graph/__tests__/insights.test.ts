import { describe, expect, it } from "vitest";
import { buildGraph } from "../buildGraph";
import { computeInsights, emphasis } from "../insights";
import { BLOCKS, data, issue, link, site } from "./helpers";

const A = site("a");

function sample() {
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
    expect([...emphasis("blocked", i)!.nodes]).toEqual(["a:B-1"]);
    expect([...emphasis("critical", i)!.edges]).toEqual(["a:link:2"]);
  });
});
