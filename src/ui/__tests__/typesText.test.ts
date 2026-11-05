import { describe, expect, it } from "vitest";
import { typesText } from "../typesText";

const input = (type: string): { tagName: string; type: string } => ({ tagName: "INPUT", type });

describe("typesText", () => {
  it("is true where a letter key types (so g / t mustn't switch the view)", () => {
    for (const type of ["text", "search", "number", "date", "email", "url", "password", ""])
      expect(typesText(input(type)), type).toBe(true);
    expect(typesText({ tagName: "TEXTAREA" })).toBe(true);
    expect(typesText({ tagName: "SELECT" })).toBe(true);
    expect(typesText({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  // The view switch's radios announce g / t (aria-keyshortcuts): those keys must work there.
  it("is false for controls where a letter key does nothing, like the view switch's radios", () => {
    for (const type of ["radio", "checkbox", "button", "submit", "range", "color"]) expect(typesText(input(type)), type).toBe(false);
    expect(typesText({ tagName: "BUTTON" })).toBe(false);
    expect(typesText({ tagName: "DIV" })).toBe(false);
  });
});
