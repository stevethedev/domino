import { describe, expect, it } from "vitest";
import { regionFor } from "../Announcer";

describe("regionFor", () => {
  const page = { polite: "page-polite", assertive: "page-assertive" };
  const dialog = { polite: "dialog-polite", assertive: "dialog-assertive" };

  it("is the page's regions while nothing else listens", () => {
    expect(regionFor([page], false)).toBe("page-polite");
    expect(regionFor([page], true)).toBe("page-assertive");
  });

  it("is an open modal's regions, the rest of the page being inert", () => {
    expect(regionFor([page, dialog], false)).toBe("dialog-polite");
    expect(regionFor([page, dialog], true)).toBe("dialog-assertive");
  });

  it("is nowhere before any regions mount", () => {
    expect(regionFor([], false)).toBeUndefined();
  });
});
