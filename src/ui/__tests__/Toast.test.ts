import { describe, expect, it, vi } from "vitest";
import { toastAnnouncement } from "../Toast";

describe("toastAnnouncement", () => {
  it("says a plain notice as it reads", () => {
    expect(toastAnnouncement({ text: "Started fresh." })).toBe("Started fresh.");
  });

  it("says that its action is there to reach", () => {
    expect(toastAnnouncement({ text: "Cleared the Display filters to show CORE-7.", action: { label: "Undo", run: vi.fn() } })).toBe(
      "Cleared the Display filters to show CORE-7. Undo is available.",
    );
  });
});
