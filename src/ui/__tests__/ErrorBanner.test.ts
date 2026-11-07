import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SiteConfig } from "../../config/types";
import { ErrorBanner, errorBannerTitle, siteErrorText } from "../ErrorBanner";
import { markupText } from "./markupText";

describe("siteErrorText", () => {
  it("names the site once", () => {
    expect(siteErrorText("Acme", "Acme returned 401 (check the email and API token)")).toBe(
      "Acme returned 401 (check the email and API token)",
    );
    expect(siteErrorText("Acme", "timeout")).toBe("Acme: timeout");
    expect(siteErrorText("Acme", "Acmeish failed")).toBe("Acme: Acmeish failed");
  });
});

describe("errorBannerTitle", () => {
  it("counts sites that failed apart from those still showing earlier tickets", () => {
    expect(errorBannerTitle(1, 0, 1)).toBe("The site failed to load.");
    expect(errorBannerTitle(2, 0, 2)).toBe("All sites failed to load.");
    expect(errorBannerTitle(1, 0, 3)).toBe("1 site failed to load; showing the rest.");
    expect(errorBannerTitle(0, 1, 2)).toBe("1 site couldn't update; showing its earlier tickets.");
    expect(errorBannerTitle(0, 2, 2)).toBe("2 sites couldn't update; showing their earlier tickets.");
    // One failed, the other only lags: there's no fresh "rest" to speak of.
    expect(errorBannerTitle(1, 1, 2)).toBe("1 site failed to load, and 1 couldn't update (showing its earlier tickets).");
  });
});

describe("ErrorBanner", () => {
  it("keeps each failed site's message apart, as it's read out", () => {
    const site = (id: string, label: string): SiteConfig => ({
      id,
      label,
      baseUrl: `https://${id}.atlassian.net`,
      auth: { type: "apiToken", email: "bot@example.com", secretRef: "DOMINO_TOKEN" },
      color: "#123456",
      enabled: true,
    });
    const sites = [site("acme", "Acme"), site("partner", "Partner")];
    const html = renderToStaticMarkup(
      createElement(ErrorBanner, {
        errors: [
          { siteId: "acme", message: "timeout" },
          { siteId: "partner", message: "timeout" },
        ],
        lagging: [],
        sites,
        attempted: 2,
        onRetry: () => undefined,
        onOpenSettings: () => undefined,
      }),
    );
    expect(markupText(html)).toContain("Acme: timeout Partner: timeout");
  });
});
