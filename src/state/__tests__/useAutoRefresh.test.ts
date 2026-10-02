import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAutoRefresh, type VisibilitySource } from "../useAutoRefresh";

const MIN = 60_000;

class FakeDocument extends EventTarget implements VisibilitySource {
  hidden = false;
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

describe("startAutoRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes once the interval since the last update has passed, then keeps polling", async () => {
    const refresh = vi.fn(() => Promise.resolve());
    const stop = startAutoRefresh(refresh, 5 * MIN, 0, new FakeDocument());
    await vi.advanceTimersByTimeAsync(5 * MIN - 1);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * MIN);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("keeps polling after a failed refresh", async () => {
    const refresh = vi.fn(() => Promise.reject(new Error("offline")));
    const stop = startAutoRefresh(refresh, MIN, 0, new FakeDocument());
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(refresh).toHaveBeenCalledTimes(3);
    stop();
  });

  it("doesn't poll while hidden, and refreshes on return once the interval has passed", async () => {
    const refresh = vi.fn(() => Promise.resolve());
    const doc = new FakeDocument();
    const stop = startAutoRefresh(refresh, 5 * MIN, 0, doc);
    doc.setHidden(true);
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(refresh).not.toHaveBeenCalled();
    doc.setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it("returning before the interval is up waits out the rest", async () => {
    const refresh = vi.fn(() => Promise.resolve());
    const doc = new FakeDocument();
    const stop = startAutoRefresh(refresh, 5 * MIN, 0, doc);
    doc.setHidden(true);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    doc.setHidden(false);
    await vi.advanceTimersByTimeAsync(3 * MIN - 1);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops for good", async () => {
    const refresh = vi.fn(() => Promise.resolve());
    const doc = new FakeDocument();
    startAutoRefresh(refresh, MIN, 0, doc)();
    doc.setHidden(false);
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(refresh).not.toHaveBeenCalled();
  });
});
