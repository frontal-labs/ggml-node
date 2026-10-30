import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//u, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/` }],
  },
  test: {
    coverage: {
      include: ["src/core/**", "src/registry/**", "src/ai/**"],
      provider: "v8",
      thresholds: { lines: 85 },
    },
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/e2e/**/*.test.ts"],
  },
});
