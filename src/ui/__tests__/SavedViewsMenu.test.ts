import { describe, expect, it } from "vitest";
import { MAX_SAVED_VIEWS } from "../../state/savedViews";
import { importText } from "../SavedViewsMenu";

describe("importText", () => {
  it("says what was added, replaced and skipped", () => {
    expect(importText({ added: ["A", "B"], replaced: [], skipped: [] })).toBe("Imported 2 views.");
    expect(importText({ added: ["A"], replaced: ["B"], skipped: [] })).toBe("Imported 2 views (1 replaced a view with the same name).");
    expect(importText({ added: [], replaced: [], skipped: ["C"] })).toBe(
      `Imported nothing. 1 view not imported (C): Domino keeps at most ${MAX_SAVED_VIEWS}. Delete some, then import again.`,
    );
  });
});
