import { afterEach, describe, expect, it, vi } from "vitest";
import { oneOf, readStored, writeStored } from "../storage";

type FakeStorage = Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> };

function fakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string): string | null => data.get(k) ?? null,
    setItem: (k: string, v: string): void => void data.set(k, v),
    data,
  };
}

const isColor = (v: string): v is "red" | "blue" => v === "red" || v === "blue";

afterEach(() => vi.unstubAllGlobals());

describe("storage", () => {
  it("round-trips JSON and validates on read", () => {
    const s = fakeStorage();
    vi.stubGlobal("localStorage", s);
    writeStored("k", "blue");
    expect(s.data.get("k")).toBe('"blue"');
    expect(readStored("k", oneOf(isColor), "red")).toBe("blue");
  });

  it("reads values stored before JSON encoding, and falls back on invalid ones", () => {
    vi.stubGlobal("localStorage", fakeStorage({ legacy: "blue", bad: '"green"' }));
    expect(readStored("legacy", oneOf(isColor), "red")).toBe("blue");
    expect(readStored("bad", oneOf(isColor), "red")).toBe("red");
    expect(readStored("missing", oneOf(isColor), "red")).toBe("red");
  });

  it("falls back when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    });
    expect(readStored("k", oneOf(isColor), "red")).toBe("red");
    expect(() => { writeStored("k", "blue"); }).not.toThrow();
  });
});
