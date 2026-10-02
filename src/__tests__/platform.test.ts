import { afterEach, describe, expect, it, vi } from "vitest";
import { copyImage } from "../platform";

describe("copyImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes to the clipboard before the image is ready, so WebKit still sees the click", () => {
    const write = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(readonly items: Record<string, Promise<Blob>>) {}
      },
    );
    const png = new Promise<Blob>(() => undefined); // never resolves: the write must not wait for it
    void copyImage(png);
    expect(write).toHaveBeenCalledOnce();
  });
});
