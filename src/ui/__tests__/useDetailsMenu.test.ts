import { describe, expect, it } from "vitest";
import { leavesMenu } from "../useDetailsMenu";

describe("leavesMenu", () => {
  // Stand-ins for DOM nodes: only their identity matters to the menu's `contains`.
  const inside = {} as Node;
  const outside = {} as Node;
  const menu = { contains: (n: Node | null): boolean => n === inside };

  it("is true when focus moves to something outside the menu", () => {
    expect(leavesMenu(menu, outside)).toBe(true);
  });

  it("is false when focus moves within the menu", () => {
    expect(leavesMenu(menu, inside)).toBe(false);
  });

  it("is false with nowhere to go: the window lost focus, or a click took none", () => {
    expect(leavesMenu(menu, null)).toBe(false);
  });
});
