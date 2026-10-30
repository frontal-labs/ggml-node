import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/` }],
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/e2e/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/core/**", "src/registry/**", "src/ai/**"],
      thresholds: { lines: 85 },
    },
  },
});
