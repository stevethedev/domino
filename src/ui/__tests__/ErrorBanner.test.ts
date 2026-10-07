import { describe, expect, it } from "vitest";
import { siteErrorText } from "../ErrorBanner";

describe("siteErrorText", () => {
  it("names the site once", () => {
    expect(siteErrorText("Acme", "Acme returned 401 (check the email and API token)")).toBe(
      "Acme returned 401 (check the email and API token)",
    );
    expect(siteErrorText("Acme", "timeout")).toBe("Acme: timeout");
    expect(siteErrorText("Acme", "Acmeish failed")).toBe("Acme: Acmeish failed");
  });
});
