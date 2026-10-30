import { defineConfig } from "tsup";

const shared = {
  format: ["esm"] as ["esm"],
  target: "node20" as const,
  platform: "node" as const,
  sourcemap: true,
  treeshake: true,
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: "src/index.ts",
      "ai/index": "src/ai/index.ts",
      "testing/index": "src/testing/index.ts",
    },
    splitting: true,
    clean: true,
    dts: true,
  },
  {
    ...shared,
    entry: { "cli/index": "src/cli/index.ts" },
    splitting: true,
    clean: false,
    dts: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
