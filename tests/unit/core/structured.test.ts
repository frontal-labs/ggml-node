import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { isGgmlNodeError } from "@/core/errors.js";
import { createGgmlNodeWithDeps, type GgmlNodeDeps } from "@/core/ggml-node.js";
import {
  assertSupportedSchema,
  withSchemaInstruction,
  zodToJsonSchema,
} from "@/core/structured.js";
import type { Message } from "@/core/types.js";
import { createFakeBackend } from "../../helpers/fake-backend.js";

const expectCode = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (err) {
    expect(isGgmlNodeError(err) && err.code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

describe("assertSupportedSchema", () => {
  it("accepts the supported subset", () => {
    expect(() =>
      assertSupportedSchema({
        additionalProperties: false,
        description: "a label",
        properties: {
          label: { enum: ["spam", "ham"], type: "string" },
          maybe: { type: ["string", "null"] },
          score: { type: "number" },
          tags: { items: { type: "string" }, maxItems: 5, type: "array" },
          when: { format: "date-time", type: "string" },
        },
        required: ["label", "score"],
        type: "object",
      }),
    ).not.toThrow();
  });

  it("rejects keywords the grammar cannot enforce, and names the keyword", () => {
    for (const bad of [
      { minimum: 0, type: "number" },
      { pattern: "^a", type: "string" },
      { format: "email", type: "string" },
      { anyOf: [{ type: "string" }, { type: "null" }] },
      { properties: { a: { multipleOf: 2, type: "string" } }, type: "object" },
    ]) {
      expectCode(() => assertSupportedSchema(bad), "INVALID_OPTIONS");
    }
  });

  it("names the offending keyword in the message", () => {
    try {
      assertSupportedSchema({ properties: { n: { minimum: 1, type: "number" } }, type: "object" });
      throw new Error("expected a throw");
    } catch (err) {
      expect(isGgmlNodeError(err) && err.message).toContain('"minimum"');
      expect(isGgmlNodeError(err) && err.message).toContain("#/properties/n");
    }
  });

  it("requires $ref to point into #/$defs/", () => {
    expectCode(
      () => assertSupportedSchema({ $ref: "https://example.test/x.json" }),
      "INVALID_OPTIONS",
    );
    expect(() =>
      assertSupportedSchema({
        $defs: { node: { type: "string" } },
        properties: { child: { $ref: "#/$defs/node" } },
        type: "object",
      }),
    ).not.toThrow();
  });

  it("allows annotation keywords", () => {
    expect(() =>
      assertSupportedSchema({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title: "x",
        type: "string",
      }),
    ).not.toThrow();
  });
});

describe("zodToJsonSchema", () => {
  it("converts a Zod 4 object and removes $schema", async () => {
    const json = await zodToJsonSchema(
      z.object({ label: z.enum(["a", "b"]), n: z.number().int() }),
    );
    expect(json).not.toHaveProperty("$schema");
    expect(json.type).toBe("object");
    expect(json.required).toEqual(["label", "n"]);
    expect(json.additionalProperties).toBe(false);
  });

  it("rewrites anyOf to oneOf so nullable and union types are accepted", async () => {
    const json = await zodToJsonSchema(z.object({ v: z.union([z.string(), z.number()]) }));
    const text = JSON.stringify(json);
    expect(text).not.toContain("anyOf");
    expect(() => assertSupportedSchema(json)).not.toThrow();
  });

  it("drops only the safe-integer bounds Zod adds to every integer", async () => {
    const json = await zodToJsonSchema(z.object({ age: z.number().int() }));
    const { age } = json.properties as Record<string, Record<string, unknown>>;
    expect(age).toEqual({ type: "integer" });
    expect(() => assertSupportedSchema(json)).not.toThrow();
  });

  it("produces a schema the grammar rejects when Zod adds a numeric bound", async () => {
    const json = await zodToJsonSchema(z.object({ score: z.number().min(0) }));
    expectCode(() => assertSupportedSchema(json), "INVALID_OPTIONS");
  });
});

describe("withSchemaInstruction", () => {
  it("adds a system message when there is none", () => {
    const out = withSchemaInstruction([{ content: "hi", role: "user" }], { type: "string" });
    expect(out[0]?.role).toBe("system");
    expect(out[0]?.content).toContain('{"type":"string"}');
    expect(out[1]).toEqual({ content: "hi", role: "user" });
  });

  it("appends to an existing system message", () => {
    const messages: Message[] = [
      { content: "Be terse.", role: "system" },
      { content: "hi", role: "user" },
    ];
    const out = withSchemaInstruction(messages, { type: "string" }, "Answer");
    expect(out).toHaveLength(2);
    expect(out[0]?.content.startsWith("Be terse.")).toBe(true);
    expect(out[0]?.content).toContain('named "Answer"');
  });
});

describe("object()", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ggml-node-obj-"));
    await writeFile(join(dir, "m.gguf"), Buffer.alloc(100));
  });
  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  function make(reply: string) {
    const backend = createFakeBackend({ respond: () => reply });
    const deps: Partial<GgmlNodeDeps> = {
      createBackend: () => backend,
      env: { GGML_NODE_CACHE_DIR: dir },
      memory: {
        availableSystemBytes: async () => 1e12,
        cgroupCurrentBytes: async () => undefined,
        cgroupLimitBytes: async () => undefined,
      },
      readMeta: async () => ({
        kind: "generation",
        shape: { blockCount: 1, headCountKv: 1, keyLength: 8, valueLength: 8 },
        sizeBytes: 100,
        trainContextSize: 4096,
      }),
    };
    return { ai: createGgmlNodeWithDeps({ model: { path: join(dir, "m.gguf") } }, deps), backend };
  }

  it("returns the parsed object with raw text and the generation metadata", async () => {
    const schema = z.object({ label: z.enum(["spam", "ham"]), score: z.number() });
    const { ai, backend } = make('{"label":"spam","score":0.9}');
    const r = await ai.object({ prompt: "Classify: win money now", schema });
    expect(r.object).toEqual({ label: "spam", score: 0.9 });
    expect(r.raw).toBe('{"label":"spam","score":0.9}');
    expect(r.usage.outputTokens).toBeGreaterThan(0);
    expect(backend.grammarBuilds).toBe(1);
  });

  it("throws SCHEMA_VIOLATION when Zod validation fails", async () => {
    const schema = z.object({ label: z.enum(["spam", "ham"]) });
    const { ai } = make('{"label":"maybe"}');
    const err = await ai.object({ prompt: "x", schema }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isGgmlNodeError(err) && err.code).toBe("SCHEMA_VIOLATION");
  });

  it("throws SCHEMA_VIOLATION when the output is not JSON", async () => {
    const { ai } = make("not json at all");
    const err = await ai.object({ prompt: "x", schema: { type: "object" } }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isGgmlNodeError(err) && err.code).toBe("SCHEMA_VIOLATION");
  });

  it("accepts a plain JSON Schema and returns unknown unless a type is given", async () => {
    const { ai } = make('{"name":"x"}');
    const r = await ai.object({
      prompt: "x",
      schema: { properties: { name: { type: "string" } }, type: "object" },
    });
    expect(r.object).toEqual({ name: "x" });
  });

  it("rejects unsupported schema keywords at call time with INVALID_OPTIONS", async () => {
    const { ai } = make("{}");
    const err = await ai
      .object({
        prompt: "x",
        schema: { properties: { n: { minimum: 0, type: "number" } }, type: "object" },
      })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(isGgmlNodeError(err) && err.code).toBe("INVALID_OPTIONS");
  });

  it("rejects a schema argument that is not an object", async () => {
    const { ai } = make("{}");
    const err = await ai
      .object({ prompt: "x", schema: "nope" as unknown as Record<string, unknown> })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(isGgmlNodeError(err) && err.code).toBe("INVALID_OPTIONS");
  });
});
