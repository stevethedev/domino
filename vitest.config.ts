import { defineConfig } from "vitest/config";

export default defineConfig({
  // Fixtures pin UTC instants; days are bucketed in the local timezone, so pin it for stable results.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    env: { TZ: "UTC" },
    // CSS imports are empty in tests unless listed: the token contrast test reads tokens.css.
    css: { include: [/tokens\.css/] },
  },
});
