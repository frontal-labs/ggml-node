import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createIsolatedBackend } from "@/backend/host.js";
import { isGgmlNodeError } from "@/core/errors.js";
import { createGgmlNodeWithDeps } from "@/core/ggml-node.js";
import type { GgmlNode, GgmlNodeEvent, GgmlNodeOptions } from "@/core/types.js";

import { FAKE_DIMENSIONS } from "../helpers/fake-backend.js";

const WORKER = fileURLToPath(new URL("../helpers/fake-worker.ts", import.meta.url));

/** Child processes run under tsx, with the host's Node, so the .ts worker entry loads. */
const childOptions = { execArgv: ["--import", "tsx"], execPath: "node", workerPath: WORKER };

describe("process isolation", () => {
  let dir: string;
  const made: GgmlNode[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ggml-node-iso-"));
    await writeFile(join(dir, "m.gguf"), Buffer.alloc(100));
  });

  afterEach(async () => {
    await Promise.all(made.splice(0).map((ai) => ai.unload()));
    await rm(dir, { force: true, recursive: true });
  });

  function isolated(
    backendOptions: Parameters<typeof createIsolatedBackend>[0] = {},
    options: Partial<GgmlNodeOptions> = {},
    events: GgmlNodeEvent[] = [],
  ): GgmlNode {
    const ai = createGgmlNodeWithDeps(
      {
        isolation: "process",
        model: { path: join(dir, "m.gguf") },
        onEvent: (e) => events.push(e),
        ...options,
      },
      {
        createIsolatedBackend: () => createIsolatedBackend({ ...childOptions, ...backendOptions }),
        env: { GGML_NODE_CACHE_DIR: dir },
        memory: {
          availableSystemBytes: async () => 1e12,
          cgroupCurrentBytes: async () => undefined,
          cgroupLimitBytes: async () => undefined,
        },
        pathExists: async () => true,
        readMeta: async () => ({
          kind: "generation",
          shape: { blockCount: 1, headCountKv: 1, keyLength: 8, valueLength: 8 },
          sizeBytes: 100,
          trainContextSize: 4096,
        }),
      },
    );
    made.push(ai);
    return ai;
  }

  it("generates through the child process with the same result shape", async () => {
    const ai = isolated();
    const r = await ai.generate({ prompt: "hello there", temperature: 0 });
    expect(r.text).toBe("echo: hello there");
    expect(r.finishReason).toBe("stop");
    expect(r.usage.outputTokens).toBe(3);
    expect(r.model).toBe("custom");
  }, 30_000);

  it("embeds through the child process, with the same result shape", async () => {
    const ai = isolated({}, { kind: "embedding" });
    const r = await ai.embed({ input: ["hello there", "again"] });
    expect(r.embeddings).toHaveLength(2);
    expect(r.dimensions).toBe(FAKE_DIMENSIONS);
    expect(r.embeddings[0]).toHaveLength(FAKE_DIMENSIONS);
    expect(r.usage.inputTokens).toBe(3);
    expect(r.model).toBe("custom");
  }, 30_000);

  it("streams deltas from the child", async () => {
    const ai = isolated();
    const s = ai.stream({ prompt: "one two three" });
    const pieces: string[] = [];
    for await (const piece of s.textStream) {
      pieces.push(piece);
    }
    expect(pieces.join("")).toBe("echo: one two three");
    expect((await s.result).text).toBe("echo: one two three");
  }, 30_000);

  it("runs grammar-constrained output and returns the parsed value", async () => {
    const schema = z.object({ label: z.string() });
    const ai = isolated();
    const r = await ai.object({ prompt: "classify this", schema });
    expect(r.object).toEqual({ label: "ok" });
  }, 30_000);

  it("a crash mid-generation fails the request with BACKEND_CRASHED, and the next call respawns", async () => {
    const events: GgmlNodeEvent[] = [];
    const ai = isolated({}, {}, events);
    await ai.ready();

    const crashed = await ai.generate({ prompt: "CRASH now" }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isGgmlNodeError(crashed) && crashed.code).toBe("BACKEND_CRASHED");

    const recovered = await ai.generate({ prompt: "back again" });
    expect(recovered.text).toBe("echo: back again");
  }, 60_000);

  it("stops restarting after the restart budget and says how to recover", async () => {
    const ai = isolated({ maxRestarts: 1, restartWindowMs: 60_000 });
    await ai.ready();
    await ai.generate({ prompt: "CRASH one" }).catch(() => undefined);
    await ai.generate({ prompt: "fine" }); // restart 1, allowed
    await ai.generate({ prompt: "CRASH two" }).catch(() => undefined);

    const err = await ai.generate({ prompt: "third" }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isGgmlNodeError(err) && err.code).toBe("BACKEND_CRASHED");
    expect(isGgmlNodeError(err) && err.hint).toContain("stays stopped");
  }, 60_000);

  it("aborting a running request stops the child's generation", async () => {
    const ai = isolated();
    const controller = new AbortController();
    const p = ai.generate({ prompt: "a b c d e f g h i j k l m n o p", signal: controller.signal });
    setTimeout(() => controller.abort(), 15);
    const err = await p.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isGgmlNodeError(err) && err.code).toBe("ABORTED");
  }, 30_000);

  it("unload stops the child; the next call reloads it", async () => {
    const ai = isolated();
    await ai.generate({ prompt: "first" });
    await ai.unload();
    expect(ai.info()).toBeNull();
    const again = await ai.generate({ prompt: "second" });
    expect(again.text).toBe("echo: second");
  }, 30_000);
});
