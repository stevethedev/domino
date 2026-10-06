import { describe, expect, it } from "vitest";
import { cacheStorage } from "../mockIpc";
import type { MockCacheStore } from "../mockTicketCache";

const entry: MockCacheStore = { s: { appVersion: "1", scopeKey: "s", viewedAt: 1, sites: [], errors: [] } };

describe("cacheStorage", () => {
  it("falls back to memory when storage is blocked (every call throws)", () => {
    const blocked = {
      getItem: (): never => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: (): never => {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem: (): never => {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    const store = cacheStorage(blocked);
    expect(() => {
      store.write(entry);
    }).not.toThrow();
    expect(store.read()).toEqual(entry);
  });
});
