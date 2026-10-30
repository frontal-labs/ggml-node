import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const registerHook = fileURLToPath(
  new URL("../../helpers/register-native-hook.mjs", import.meta.url),
);
const entry = fileURLToPath(new URL("../../helpers/import-testing.ts", import.meta.url));

describe("local-llm/testing", () => {
  it("imports without loading node-llama-cpp", () => {
    // A fresh process, so nothing loaded by other tests can hide a native import.
    const run = spawnSync(process.execPath, ["--import", "tsx", "--import", registerHook, entry], {
      encoding: "utf8",
    });
    expect(run.stdout).toContain("TESTING_IMPORTED");
    expect(run.stderr).not.toContain("NATIVE_IMPORT");
  }, 60_000);
});
