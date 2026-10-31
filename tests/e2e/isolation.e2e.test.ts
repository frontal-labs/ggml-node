import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createIsolatedBackend } from "@/backend/host.js";
import { createGgmlNodeWithDeps, type GgmlNodeDeps } from "@/core/ggml-node.js";
import type { GgmlNodeOptions } from "@/core/types.js";
import { env } from "@/env.js";

/**
 * Real model in a child process, using the built worker that the published package forks.
 * Needs `bun run build` first. Opt-in: GGML_NODE_E2E=1.
 */
const enabled = env.GGML_NODE_E2E === "1";
const WHITESPACE = /\s+/u;
const WORKER = fileURLToPath(new URL("../../dist/backend/worker-main.js", import.meta.url));
const workerBuilt = existsSync(WORKER);

function isolatedLocalLLM(options: Omit<GgmlNodeOptions, "isolation">) {
  const overrides: Partial<GgmlNodeDeps> = {
    createIsolatedBackend: () => createIsolatedBackend({ execPath: "node", workerPath: WORKER }),
  };
  return createGgmlNodeWithDeps({ ...options, isolation: "process" }, overrides);
}

/** The worker is a direct child of this process, so pgrep on its command line finds it. */
function workerPids(): number[] {
  try {
    const out = execFileSync("pgrep", ["-P", String(process.pid), "-f", "worker-main"], {
      encoding: "utf8",
    });
    return out.split(WHITESPACE).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

describe.skipIf(!(enabled && workerBuilt))("e2e: process isolation with the real model", () => {
  it("generates in the child with the same result shape as in-process", async () => {
    const ai = isolatedLocalLLM({ maxConcurrency: 1, model: "qwen2.5-0.5b" });
    const r = await ai.generate({
      maxTokens: 24,
      messages: [{ content: "Name one planet.", role: "user" }],
      seed: 1,
      temperature: 0,
    });
    expect(r.text.trim().length).toBeGreaterThan(0);
    expect(r.model).toBe("qwen2.5-0.5b");
    expect(workerPids().length).toBeGreaterThan(0);
    await ai.unload();
  }, 300_000);

  it("kills the child mid-generation: BACKEND_CRASHED, then a fresh child answers", async () => {
    const ai = isolatedLocalLLM({ model: "qwen2.5-0.5b" });
    await ai.ready();
    const pending = ai
      .generate({ maxTokens: 256, prompt: "Write a long story about a river.", temperature: 0.7 })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    await new Promise((r) => setTimeout(r, 1500));
    for (const pid of workerPids()) {
      process.kill(pid, "SIGKILL");
    }

    const err = await pending;
    expect(err).toMatchObject({ code: "BACKEND_CRASHED" });

    const again = await ai.generate({ maxTokens: 16, prompt: "Say hi.", temperature: 0 });
    expect(again.text.length).toBeGreaterThan(0);
    await ai.unload();
  }, 300_000);
});
