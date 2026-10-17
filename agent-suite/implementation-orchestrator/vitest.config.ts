import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/src/**/*.test.ts", "packages/**/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 30_000,
  },
});
