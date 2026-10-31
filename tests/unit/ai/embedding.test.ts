import { embedMany } from "ai";
import { describe, expect, it } from "vitest";
import { embeddingModelFor } from "@/ai/model.js";
import { isGgmlNodeError } from "@/core/errors.js";
import { createMockGgmlNode } from "../../mocks/index.js";

describe("embedding model (AI SDK)", () => {
  it("returns embeddings in input order with the token usage", async () => {
    const model = embeddingModelFor(
      "mock",
      createMockGgmlNode({ dimensions: 6, kind: "embedding" }),
    );
    const result = await model.doEmbed({ values: ["one two", "three"] });
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toHaveLength(6);
    expect(result.usage).toEqual({ tokens: 3 });
    expect(result.warnings).toEqual([]);
  });

  it("returns no embeddings for an empty list, without calling the model", async () => {
    const model = embeddingModelFor("mock", createMockGgmlNode({ kind: "embedding" }));
    const result = await model.doEmbed({ values: [] });
    expect(result.embeddings).toEqual([]);
    expect(result.usage).toEqual({ tokens: 0 });
  });

  it("warns, and does not fail, when dimensions are requested", async () => {
    const model = embeddingModelFor("mock", createMockGgmlNode({ kind: "embedding" }));
    const result = await model.doEmbed({ dimensions: 2, values: ["x"] });
    expect(result.warnings).toEqual([
      expect.objectContaining({ feature: "dimensions", type: "unsupported" }),
    ]);
  });

  it("works with the AI SDK's embedMany", async () => {
    const model = embeddingModelFor(
      "mock",
      createMockGgmlNode({ dimensions: 4, kind: "embedding" }),
    );
    const { embeddings, usage } = await embedMany({
      maxRetries: 0,
      model,
      values: ["alpha", "beta", "gamma"],
    });
    expect(embeddings).toHaveLength(3);
    expect(embeddings.every((v) => v.length === 4)).toBe(true);
    expect(usage.tokens).toBe(3);
  });

  it("surfaces INVALID_OPTIONS when the model is a generation model", async () => {
    const model = embeddingModelFor("mock", createMockGgmlNode({ kind: "generation" }));
    const error = await model.doEmbed({ values: ["x"] }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isGgmlNodeError(error) && error.code).toBe("INVALID_OPTIONS");
  });
});
