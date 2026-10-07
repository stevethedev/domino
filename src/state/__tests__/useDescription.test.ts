import { describe, expect, it } from "vitest";
import type { JiraSource } from "../../data/JiraSource";
import { descriptionView, forget, remember, startFetch } from "../useDescription";

describe("remember", () => {
  it("keeps the newest answers, dropping the least recently fetched", () => {
    let m: ReadonlyMap<string, number> = new Map();
    for (const k of ["a", "b", "c"]) m = remember(m, k, 1, 2);
    expect([...m.keys()]).toEqual(["b", "c"]);
    m = remember(m, "b", 2, 2); // fetched again: now the newest
    m = remember(m, "d", 1, 2);
    expect([...m.keys()]).toEqual(["b", "d"]);
    expect(m.get("b")).toBe(2);
  });
});

describe("descriptionView", () => {
  const loaded = { status: "loaded", doc: { type: "doc" } } as const;

  it("is loading, and due, with no answer yet", () => {
    expect(descriptionView(new Map(), "k", 1)).toEqual({ state: { status: "loading" }, due: true });
  });

  it("keeps showing an answer from an earlier load while fetching it again", () => {
    const answers = new Map([["k", { state: loaded, epoch: 1 }]]);
    expect(descriptionView(answers, "k", 2)).toEqual({ state: loaded, due: true });
    expect(descriptionView(answers, "k", 1)).toEqual({ state: loaded, due: false });
  });

  it("retries a failure by forgetting it: loading and due again", () => {
    const answers = new Map([["k", { state: { status: "error", message: "403" } as const, epoch: 1 }]]);
    expect(descriptionView(answers, "k", 1).state).toEqual({ status: "error", message: "403" });
    expect(descriptionView(forget(answers, "k"), "k", 1)).toEqual({ state: { status: "loading" }, due: true });
  });
});

describe("startFetch", () => {
  /** A source whose description call resolves or rejects when the test says. */
  function controllable(): { source: Pick<JiraSource, "fetchDescription">; resolve: (doc: unknown) => void; reject: (e: unknown) => void } {
    let resolve: (doc: unknown) => void = () => undefined;
    let reject: (e: unknown) => void = () => undefined;
    const pending = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return {
      source: { fetchDescription: () => pending },
      resolve: (d) => {
        resolve(d);
      },
      reject: (e) => {
        reject(e);
      },
    };
  }
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it("reports what Jira returned", async () => {
    const c = controllable();
    const got: unknown[] = [];
    startFetch(c.source, "a", "K-1", (s) => got.push(s));
    c.resolve(null);
    await settle();
    expect(got).toEqual([{ status: "loaded", doc: null }]);
  });

  it("reports a failure as a message", async () => {
    const c = controllable();
    const got: unknown[] = [];
    startFetch(c.source, "a", "K-1", (s) => got.push(s));
    c.reject(new Error("401"));
    await settle();
    expect(got).toEqual([{ status: "error", message: "401" }]);
  });

  it("drops a result that arrives after it was cancelled (another issue was opened)", async () => {
    const c = controllable();
    const got: unknown[] = [];
    const cancel = startFetch(c.source, "a", "K-1", (s) => got.push(s));
    cancel();
    c.resolve({ type: "doc" });
    await settle();
    expect(got).toEqual([]);
  });
});
