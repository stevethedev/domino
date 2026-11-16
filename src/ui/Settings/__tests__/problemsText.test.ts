import { describe, expect, it } from "vitest";
import { problemsText } from "../SiteForm";

describe("problemsText", () => {
  it("says one problem, with its field", () => {
    expect(problemsText([{ label: "Token", problem: "Paste a token" }])).toBe("1 field needs fixing: Token: Paste a token.");
  });

  it("counts several, saying each field's in turn", () => {
    expect(
      problemsText([
        { label: "Label", problem: "Required" },
        { label: "Id", problem: "Id must be unique" },
      ]),
    ).toBe("2 fields need fixing: Label: Required. Id: Id must be unique.");
  });

  it("doesn't double a message's own full stop", () => {
    expect(problemsText([{ label: "Base URL", problem: "Use https://." }])).toBe("1 field needs fixing: Base URL: Use https://.");
  });
});
