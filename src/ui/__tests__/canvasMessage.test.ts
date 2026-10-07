import { describe, expect, it } from "vitest";
import type { SiteConfig } from "../../config/types";
import { noSitesShown } from "../canvasMessage";

const site = (id: string, enabled: boolean): SiteConfig => ({
  id,
  label: id,
  baseUrl: `https://${id}.atlassian.net`,
  auth: { type: "oauth3lo" },
  color: "#000000",
  enabled,
});

describe("noSitesShown", () => {
  it("tells no sites, all turned off and none selected apart", () => {
    expect(noSitesShown([])).toBe("none");
    expect(noSitesShown([site("a", false), site("b", false)])).toBe("all off");
    expect(noSitesShown([site("a", true), site("b", false)])).toBe("none selected");
  });
});
