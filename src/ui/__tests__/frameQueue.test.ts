import { describe, expect, it, vi } from "vitest";
import { frameQueue } from "../frameQueue";

/** A stand-in for the browser's frames: `tick` runs what's due. */
function fakeFrames(): { raf: (fn: FrameRequestCallback) => number; caf: (id: number) => void; tick: () => void } {
  const due = new Map<number, FrameRequestCallback>();
  let next = 1;
  return {
    raf: (fn) => {
      due.set(next, fn);
      return next++;
    },
    caf: (id) => {
      due.delete(id);
    },
    tick: () => {
      const now = [...due.values()];
      due.clear();
      for (const fn of now) fn(0);
    },
  };
}

describe("frameQueue", () => {
  it("runs a queued job at the next frame", () => {
    const frames = fakeFrames();
    const fit = vi.fn();
    frameQueue(frames.raf, frames.caf).queue(fit);
    expect(fit).not.toHaveBeenCalled();
    frames.tick();
    expect(fit).toHaveBeenCalledOnce();
  });

  it("drops a job cancelled before its frame, as when focus pans to a card first", () => {
    const frames = fakeFrames();
    const fit = vi.fn();
    const queue = frameQueue(frames.raf, frames.caf);
    queue.queue(fit);
    queue.cancel();
    frames.tick();
    expect(fit).not.toHaveBeenCalled();
  });

  it("cancelling after the job ran, or with none queued, does nothing", () => {
    const frames = fakeFrames();
    const later = vi.fn();
    const queue = frameQueue(frames.raf, frames.caf);
    queue.cancel();
    queue.queue(vi.fn());
    frames.tick();
    queue.cancel();
    queue.queue(later);
    frames.tick();
    expect(later).toHaveBeenCalledOnce();
  });
});

describe("frameQueue waiting", () => {
  it("is true from queuing until the job runs or is cancelled", () => {
    const frames = fakeFrames();
    const queue = frameQueue(frames.raf, frames.caf);
    expect(queue.waiting()).toBe(false);
    queue.queue(vi.fn());
    expect(queue.waiting()).toBe(true);
    frames.tick();
    expect(queue.waiting()).toBe(false);
    queue.queue(vi.fn());
    queue.cancel();
    expect(queue.waiting()).toBe(false);
  });
});
