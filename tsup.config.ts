import { defineConfig } from "tsup";

const shared = {
  format: ["esm"] as ["esm"],
  platform: "node" as const,
  sourcemap: true,
  target: "node20" as const,
  treeshake: true,
};

export default defineConfig([
  {
    ...shared,
    clean: true,
    dts: true,
    entry: {
      "ai/index": "src/ai/index.ts",
      index: "src/index.ts",
      "testing/index": "tests/mocks/index.ts",
    },
    splitting: true,
  },
  {
    ...shared,
    banner: { js: "#!/usr/bin/env node" },
    clean: false,
    dts: false,
    entry: { "cli/index": "src/cli/index.ts" },
    splitting: true,
  },
  {
    // Forked by the host for `isolation: "process"`. It must sit next to dist/index.js.
    ...shared,
    clean: false,
    dts: false,
    entry: { "backend/worker-main": "src/backend/worker-main.ts" },
    splitting: true,
  },
]);
