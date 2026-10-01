import { defineConfig } from "vitest/config";

export default defineConfig({
  // Fixtures pin UTC instants; days are bucketed in the local timezone, so pin it for stable results.
  test: { environment: "node", include: ["src/**/*.test.ts"], env: { TZ: "UTC" } },
});
