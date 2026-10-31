import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelMeta } from "@/backend/gguf-meta.js";
import { isGgmlNodeError } from "@/core/errors.js";
import { createGgmlNodeWithDeps } from "@/core/ggml-node.js";
import type { GgmlNode, GgmlNodeEvent, GgmlNodeOptions, ModelKind } from "@/core/types.js";
import {
  createFakeBackend,
  FAKE_DIMENSIONS,
  type FakeBackendOptions,
} from "../../helpers/fake-backend.js";
import { createMockGgmlNode } from "../../mocks/index.js";

const INPUT_FIELD = /input/u;
const SHAPE = { blockCount: 2, headCountKv: 1, keyLength: 8, valueLength: 8 };

function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  return p.then(
    () => undefined,
    (e: unknown) => (isGgmlNodeError(e) ? e.code : `NOT_LOCAL_LLM:${String(e)}`),
  );
}

describe("embed", () => {
  let dir: string;
  let modelPath: string;
  let events: GgmlNodeEvent[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ggml-node-embed-"));
    modelPath = join(dir, "custom.gguf");
    await writeFile(modelPath, Buffer.alloc(1000));
    events = [];
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  /** `fileKind` is what the GGUF metadata says. `options.kind` in the call can override it. */
  function make(
    options: Partial<GgmlNodeOptions> = {},
    fileKind: ModelKind = "generation",
    backendOptions: FakeBackendOptions = {},
  ) {
    const backend = createFakeBackend(backendOptions);
    const meta: ModelMeta = {
      kind: fileKind,
      shape: SHAPE,
      sizeBytes: 1000,
      trainContextSize: 512,
    };
    const ai: GgmlNode = createGgmlNodeWithDeps(
      {
        model: { path: modelPath },
        onEvent: (e) => events.push(e),
        ...options,
      } as GgmlNodeOptions,
      {
        createBackend: () => backend,
        env: { GGML_NODE_CACHE_DIR: dir },
        memory: {
          availableSystemBytes: async () => 1e12,
          cgroupCurrentBytes: async () => undefined,
          cgroupLimitBytes: async () => undefined,
        },
        readMeta: async () => meta,
      },
    );
    return { ai, backend };
  }

  it("returns one vector per input, in input order, with the model's dimensions", async () => {
    const { ai } = make({}, "embedding");
    const result = await ai.embed({ input: ["alpha", "beta", "gamma"] });
    expect(result.embeddings).toHaveLength(3);
    for (const vector of result.embeddings) {
      expect(vector).toHaveLength(FAKE_DIMENSIONS);
    }
    expect(result.dimensions).toBe(FAKE_DIMENSIONS);
    expect(result.model).toBe("custom");
    expect(result.usage.inputTokens).toBe(3);
    expect(result.usage.totalTokens).toBe(3);
  });

  it("gives the same vector for the same text, and different vectors for different texts", async () => {
    const { ai } = make({}, "embedding");
    const [a, b, again] = (await ai.embed({ input: ["one", "two", "one"] })).embeddings;
    expect(again).toEqual(a);
    expect(b).not.toEqual(a);
  });

  it("accepts a single string as a batch of one", async () => {
    const { ai } = make({}, "embedding");
    const result = await ai.embed({ input: "hello there" });
    expect(result.embeddings).toHaveLength(1);
    expect(result.usage.inputTokens).toBe(2);
  });

  it("embeds a batch as one backend call", async () => {
    const { ai, backend } = make({}, "embedding");
    await ai.embed({ input: ["a", "b", "c", "d"] });
    expect(backend.embedBatches).toEqual([4]);
  });

  it("loads once, reports the load time on the first call only, and exposes kind and dimensions", async () => {
    const { ai, backend } = make({}, "embedding");
    expect(ai.info()).toBeNull();
    const first = await ai.embed({ input: "x" });
    expect(first.timing.loadMs).toBeGreaterThan(0);
    const second = await ai.embed({ input: "y" });
    expect(second.timing.loadMs).toBe(0);
    expect(backend.loads).toBe(1);
    const info = await ai.ready();
    expect(info.kind).toBe("embedding");
    expect(info.dimensions).toBe(FAKE_DIMENSIONS);
  });

  it("rejects an empty string, an empty list, and an empty string inside a list", async () => {
    const { ai } = make({}, "embedding");
    expect(await codeOf(ai.embed({ input: "" }))).toBe("INVALID_OPTIONS");
    expect(await codeOf(ai.embed({ input: [] }))).toBe("INVALID_OPTIONS");
    expect(await codeOf(ai.embed({ input: ["ok", ""] }))).toBe("INVALID_OPTIONS");
  });

  it("names the bad field in the INVALID_OPTIONS message", async () => {
    const { ai } = make({}, "embedding");
    await expect(ai.embed({ input: ["ok", ""] })).rejects.toThrow(INPUT_FIELD);
  });

  it("refuses embed() on a generation model before running anything", async () => {
    const { ai, backend } = make({}, "generation");
    expect(await codeOf(ai.embed({ input: "hi" }))).toBe("INVALID_OPTIONS");
    expect(backend.embedBatches).toEqual([]);
  });

  it("refuses generate(), stream() and object() on an embedding model", async () => {
    const { ai, backend } = make({}, "embedding");
    expect(await codeOf(ai.generate({ prompt: "hi" }))).toBe("INVALID_OPTIONS");
    const streamed = ai.stream({ prompt: "hi" });
    expect(await codeOf(streamed.result)).toBe("INVALID_OPTIONS");
    expect(await codeOf(ai.object({ prompt: "hi", schema: { type: "object" } }))).toBe(
      "INVALID_OPTIONS",
    );
    expect(backend.generations).toEqual([]);
  });

  it("reads the kind from the GGUF metadata when no kind is given", async () => {
    expect((await make({}, "embedding").ai.ready()).kind).toBe("embedding");
    expect((await make({}, "generation").ai.ready()).kind).toBe("generation");
  });

  it("lets the kind option override the GGUF metadata", async () => {
    const { ai } = make({ kind: "embedding" }, "generation");
    const info = await ai.ready();
    expect(info.kind).toBe("embedding");
    expect(info.dimensions).toBe(FAKE_DIMENSIONS);
    const result = await ai.embed({ input: "forced" });
    expect(result.embeddings[0]).toHaveLength(FAKE_DIMENSIONS);
  });

  it("has no dimensions on a generation model", async () => {
    const info = await make({}, "generation").ai.ready();
    expect(info.kind).toBe("generation");
    expect(info.dimensions).toBeUndefined();
  });

  it("emits queued, start and embed:done, and never puts the vectors in the event", async () => {
    const { ai } = make({}, "embedding");
    await ai.embed({ input: ["a", "b"] });
    const types = events.map((e) => e.type);
    expect(types).toEqual(["load:start", "load:done", "request:start", "embed:done"]);
    const done = events.find((e) => e.type === "embed:done");
    expect(done).toBeDefined();
    if (done?.type !== "embed:done") {
      throw new Error("expected an embed:done event");
    }
    expect(done.result).not.toHaveProperty("embeddings");
    expect(done.result.dimensions).toBe(FAKE_DIMENSIONS);
    expect(done.result.usage.inputTokens).toBe(2);
  });

  it("emits request:error for a refused embed() call", async () => {
    const { ai } = make({}, "generation");
    await codeOf(ai.embed({ input: "hi" }));
    const error = events.find((e) => e.type === "request:error");
    expect(error?.type === "request:error" && error.error.code).toBe("INVALID_OPTIONS");
  });

  it("the mock helper embeds when created as an embedding model", async () => {
    const mock = createMockGgmlNode({ dimensions: 5, kind: "embedding" });
    const result = await mock.embed({ input: ["x", "y"] });
    expect(result.dimensions).toBe(5);
    expect(result.embeddings.map((v) => v.length)).toEqual([5, 5]);
    expect(await codeOf(mock.generate({ prompt: "hi" }))).toBe("INVALID_OPTIONS");
  });

  it("the mock helper still generates by default", async () => {
    const mock = createMockGgmlNode();
    expect(await codeOf(mock.embed({ input: "x" }))).toBe("INVALID_OPTIONS");
    expect((await mock.generate({ prompt: "hi" })).text).toBe("echo: hi");
  });
});
