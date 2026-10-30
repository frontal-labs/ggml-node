import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isInboardError } from "../../../src/core/errors.js";
import { createInboardWithDeps, type InboardDeps } from "../../../src/core/inboard.js";
import type { Inboard, InboardEvent, InboardOptions } from "../../../src/core/types.js";
import { MODELS } from "../../../src/registry/models.js";
import { createFakeBackend, type FakeBackendOptions } from "../../helpers/fake-backend.js";

const SHAPE = { blockCount: 2, headCountKv: 1, keyLength: 8, valueLength: 8 };

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  return p.then(
    () => undefined,
    (e: unknown) => (isInboardError(e) ? e.code : `NOT_INBOARD:${String(e)}`),
  );
}

describe("createInboard", () => {
  let dir: string;
  let modelPath: string;
  let events: InboardEvent[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "inboard-core-"));
    modelPath = join(dir, "custom.gguf");
    await writeFile(modelPath, Buffer.alloc(1000));
    events = [];
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function make(
    options: Partial<InboardOptions> & Pick<InboardOptions, "model">,
    backendOptions: FakeBackendOptions = {},
    depsOverride: Partial<InboardDeps> = {},
  ) {
    const backend = createFakeBackend(backendOptions);
    const deps: InboardDeps = {
      createBackend: () => backend,
      readMeta: async () => ({ sizeBytes: 1000, trainContextSize: 4096, shape: SHAPE }),
      memory: {
        availableSystemBytes: async () => 1e12,
        cgroupLimitBytes: async () => undefined,
        cgroupCurrentBytes: async () => undefined,
      },
      env: { INBOARD_CACHE_DIR: dir },
      ...depsOverride,
    };
    const ai: Inboard = createInboardWithDeps(
      { onEvent: (e) => events.push(e), ...options } as InboardOptions,
      deps,
    );
    return { ai, backend };
  }

  const custom = () => ({ path: modelPath });

  describe("generate", () => {
    it("returns text, finish reason, usage and timing", async () => {
      const { ai } = make({ model: custom() });
      const r = await ai.generate({ prompt: "hello there" });
      expect(r.text).toBe("echo: hello there");
      expect(r.finishReason).toBe("stop");
      expect(r.model).toBe("custom");
      expect(r.usage.outputTokens).toBe(3);
      expect(r.usage.totalTokens).toBe(r.usage.inputTokens + r.usage.outputTokens);
      expect(r.timing.totalMs).toBeGreaterThanOrEqual(0);
      expect(r.timing.loadMs).toBe(0);
    });

    it("loads once, even with concurrent calls", async () => {
      const { ai, backend } = make({ model: custom(), maxConcurrency: 2 });
      await Promise.all([
        ai.ready(),
        ai.ready(),
        ai.generate({ prompt: "a" }),
        ai.generate({ prompt: "b" }),
      ]);
      expect(backend.loads).toBe(1);
    });

    it("runs no more requests at once than maxConcurrency", async () => {
      const { ai, backend } = make({ model: custom(), maxConcurrency: 2 }, { delayMs: 2 });
      await Promise.all([1, 2, 3, 4].map((i) => ai.generate({ prompt: `q${i}` })));
      expect(backend.maxActive).toBe(2);
    });

    it("clears the sequence before each request", async () => {
      const { ai, backend } = make({ model: custom() });
      await ai.generate({ prompt: "one" });
      await ai.generate({ prompt: "two" });
      expect(backend.resets).toHaveLength(2);
    });

    it("rejects with QUEUE_FULL when the queue is full", async () => {
      const { ai } = make({ model: custom(), maxConcurrency: 1, maxQueue: 0 }, { delayMs: 5 });
      const first = ai.generate({ prompt: "slow one two three" });
      const second = ai.generate({ prompt: "x" });
      expect(await codeOf(second)).toBe("QUEUE_FULL");
      await first;
    });

    it("rejects with ABORTED when aborted while running", async () => {
      const { ai } = make({ model: custom() }, { delayMs: 15 });
      const controller = new AbortController();
      const p = ai.generate({ prompt: "a b c d e f g h", signal: controller.signal });
      setTimeout(() => controller.abort(), 30);
      expect(await codeOf(p)).toBe("ABORTED");
    });

    it("rejects with ABORTED when aborted while queued, and never runs that request", async () => {
      const { ai, backend } = make(
        { model: custom(), maxConcurrency: 1, maxQueue: 5 },
        { delayMs: 5 },
      );
      const running = ai.generate({ prompt: "first long prompt here" });
      const controller = new AbortController();
      const queued = ai.generate({ prompt: "queued", signal: controller.signal });
      controller.abort();
      expect(await codeOf(queued)).toBe("ABORTED");
      await running;
      expect(backend.generations).toHaveLength(1);
    });

    it("maps backend failures to BACKEND_CRASHED with a hint and reports request:error", async () => {
      const { ai } = make({ model: custom() }, { failWith: new Error("boom") });
      const err = await ai.generate({ prompt: "x" }).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(isInboardError(err) && err.code).toBe("BACKEND_CRASHED");
      expect(isInboardError(err) && err.hint.length > 0).toBe(true);
      expect(events.some((e) => e.type === "request:error")).toBe(true);
    });

    it("emits queued, start and done events in order", async () => {
      const { ai } = make({ model: custom() });
      await ai.generate({ prompt: "hi" });
      const types = events.map((e) => e.type);
      expect(types).toEqual(["load:start", "load:done", "request:start", "request:done"]);
      const done = events.find((e) => e.type === "request:done");
      expect(done && "text" in done.result).toBe(false);
    });

    it("throws INVALID_OPTIONS when maxTokens is not below contextSize", async () => {
      const { ai } = make({ model: custom(), contextSize: 8 });
      expect(await codeOf(ai.generate({ prompt: "hi", maxTokens: 8 }))).toBe("INVALID_OPTIONS");
    });

    it("throws CONTEXT_OVERFLOW when the prompt cannot fit and overflow is error", async () => {
      const { ai } = make({ model: custom(), contextSize: 10 });
      const long = Array.from({ length: 30 }, () => "word").join(" ");
      expect(await codeOf(ai.generate({ prompt: long, maxTokens: 2 }))).toBe("CONTEXT_OVERFLOW");
    });

    it("still throws CONTEXT_OVERFLOW under truncate-start when the last user message alone is too big", async () => {
      const { ai } = make({ model: custom(), contextSize: 40 });
      const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
      const r = await ai
        .generate({
          messages: [{ role: "user", content: long }],
          maxTokens: 2,
          overflow: "truncate-start",
        })
        .catch((e: unknown) => e);
      // The last user message is never dropped, so this cannot fit and must fail.
      expect(isInboardError(r) && r.code).toBe("CONTEXT_OVERFLOW");
    });
  });

  describe("stream", () => {
    it("yields text deltas, then resolves the result with the full text", async () => {
      const { ai } = make({ model: custom() });
      const s = ai.stream({ prompt: "one two three" });
      const pieces: string[] = [];
      for await (const piece of s.textStream) pieces.push(piece);
      const r = await s.result;
      expect(pieces.join("")).toBe("echo: one two three");
      expect(r.text).toBe("echo: one two three");
      expect(r.finishReason).toBe("stop");
    });

    it("abort while running resolves the result with finishReason abort and keeps partial text", async () => {
      const { ai } = make({ model: custom() }, { delayMs: 10 });
      const s = ai.stream({ prompt: "a b c d e f g h i j k l" });
      const seen: string[] = [];
      const reading = (async () => {
        for await (const piece of s.textStream) {
          seen.push(piece);
          if (seen.length === 2) s.abort();
        }
      })();
      const r = await s.result;
      await reading;
      expect(r.finishReason).toBe("abort");
      expect(r.text.length).toBeGreaterThan(0);
      expect(r.text.split(" ").length).toBeLessThan(12);
    });

    it("abort while queued resolves with empty text and never runs", async () => {
      const { ai, backend } = make(
        { model: custom(), maxConcurrency: 1, maxQueue: 5 },
        { delayMs: 5 },
      );
      const running = ai.generate({ prompt: "first one" });
      const s = ai.stream({ prompt: "queued" });
      s.abort();
      const r = await s.result;
      expect(r.finishReason).toBe("abort");
      expect(r.text).toBe("");
      await running;
      expect(backend.generations).toHaveLength(1);
    });

    it("a rejected stream rejects both the iterator and the result", async () => {
      const { ai } = make({ model: custom() }, { failWith: new Error("boom") });
      const s = ai.stream({ prompt: "x" });
      await expect(s.result).rejects.toMatchObject({ code: "BACKEND_CRASHED" });
      await expect(
        (async () => {
          for await (const _ of s.textStream) void _;
        })(),
      ).rejects.toMatchObject({ code: "BACKEND_CRASHED" });
    });
  });

  describe("lifecycle", () => {
    it("info() is null before load and set after ready()", async () => {
      const { ai } = make({ model: custom(), contextSize: 512 });
      expect(ai.info()).toBeNull();
      const info = await ai.ready();
      expect(info.contextSize).toBe(512);
      expect(info.backend).toBe("llama-cpp");
      expect(ai.info()).toEqual(info);
    });

    it("unload waits for in-flight requests, then frees the backend; the next call reloads", async () => {
      const { ai, backend } = make({ model: custom() }, { delayMs: 3 });
      const inflight = ai.generate({ prompt: "one two three four" });
      await new Promise((r) => setTimeout(r, 5));
      await ai.unload();
      expect(backend.unloads).toBe(1);
      expect((await inflight).finishReason).toBe("stop");
      expect(ai.info()).toBeNull();
      await ai.generate({ prompt: "again" });
      expect(backend.loads).toBe(2);
    });

    it("object() is not available yet", async () => {
      const { ai } = make({ model: custom() });
      expect(await codeOf(ai.object({ schema: { type: "object" } }))).toBe("INVALID_OPTIONS");
    });

    it("countTokens loads the model and counts", async () => {
      const { ai } = make({ model: custom() });
      expect(await ai.countTokens("one two three")).toBe(3);
    });
  });

  describe("options and errors", () => {
    it("rejects unknown registry ids", () => {
      try {
        make({ model: "gpt-4o" as never });
        expect.unreachable();
      } catch (err) {
        expect(isInboardError(err) && err.code).toBe("INVALID_OPTIONS");
      }
    });

    it("rejects invalid concurrency and queue values", () => {
      expect(() => make({ model: custom(), maxConcurrency: 0 })).toThrow();
      expect(() => make({ model: custom(), maxQueue: -1 })).toThrow();
    });

    it("rejects isolation: process until it is implemented", () => {
      try {
        make({ model: custom(), isolation: "process" });
        expect.unreachable();
      } catch (err) {
        expect(isInboardError(err) && err.code).toBe("INVALID_OPTIONS");
      }
    });

    it("reports MODEL_NOT_FOUND for a custom path that does not exist", async () => {
      const { ai } = make({ model: { path: join(dir, "missing.gguf") } });
      expect(await codeOf(ai.ready())).toBe("MODEL_NOT_FOUND");
    });

    it("runs the memory preflight before loading and reports OUT_OF_MEMORY", async () => {
      const { ai, backend } = make(
        { model: custom(), maxConcurrency: 4, contextSize: 4096 },
        {},
        {
          memory: {
            availableSystemBytes: async () => 1000,
            cgroupLimitBytes: async () => undefined,
            cgroupCurrentBytes: async () => undefined,
          },
        },
      );
      expect(await codeOf(ai.ready())).toBe("OUT_OF_MEMORY");
      expect(backend.loads).toBe(0);
    });

    it("uses the registry model when given an id, with its license and context length", async () => {
      const entry = MODELS["qwen2.5-0.5b"];
      await writeFile(join(dir, entry.file), Buffer.alloc(0));
      await truncate(join(dir, entry.file), entry.sizeBytes);
      const { ai } = make({ model: "qwen2.5-0.5b" });
      const info = await ai.ready();
      expect(info.id).toBe("qwen2.5-0.5b");
      expect(info.license).toBe("Apache-2.0");
      expect(info.contextSize).toBe(Math.min(entry.contextLength, 4096));
    });

    it("offline with no cached registry file reports MODEL_NOT_FOUND", async () => {
      const { ai } = make({ model: "qwen2.5-1.5b", offline: true });
      expect(await codeOf(ai.ready())).toBe("MODEL_NOT_FOUND");
    });
  });
});
