import { describe, expect, it } from "vitest";
import { env } from "@/env.js";
import { createGgmlNode, isGgmlNodeError } from "@/index.js";

/**
 * Real embedding model, real backend. Opt-in: set GGML_NODE_E2E=1 and GGML_NODE_EMBED_MODEL to the
 * path of an embedding GGUF file (for example bge-small-en-v1.5, Q8_0, 384 dimensions).
 */
const modelPath = env.GGML_NODE_EMBED_MODEL;
const enabled = env.GGML_NODE_E2E === "1" && modelPath !== undefined;

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [i, value] of a.entries()) {
    const other = b[i] ?? 0;
    dot += value * other;
    normA += value * value;
    normB += other * other;
  }
  return dot / Math.sqrt(normA * normB);
}

describe.skipIf(!enabled)("e2e: embedding model", () => {
  const embedder = createGgmlNode({ model: { path: modelPath ?? "" } });

  it("loads as an embedding model and returns vectors of the reported size", async () => {
    const info = await embedder.ready();
    expect(info.kind).toBe("embedding");
    expect(info.dimensions).toBeGreaterThan(0);

    const result = await embedder.embed({ input: ["a cat on a mat", "stock prices fell"] });
    expect(result.embeddings).toHaveLength(2);
    for (const vector of result.embeddings) {
      expect(vector).toHaveLength(info.dimensions ?? 0);
    }
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  }, 120_000);

  it("ranks a paraphrase above an unrelated text", async () => {
    const [cat, kitten, revenue] = (
      await embedder.embed({
        input: [
          "A cat sits on the mat.",
          "A kitten is resting on a rug.",
          "Quarterly revenue rose.",
        ],
      })
    ).embeddings;
    expect(cat).toBeDefined();
    expect(kitten).toBeDefined();
    expect(revenue).toBeDefined();
    expect(cosine(cat ?? [], kitten ?? [])).toBeGreaterThan(cosine(cat ?? [], revenue ?? []));
  }, 120_000);

  it("rejects an input longer than the context with CONTEXT_OVERFLOW", async () => {
    const error = await embedder.embed({ input: "word ".repeat(5000) }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isGgmlNodeError(error) && error.code).toBe("CONTEXT_OVERFLOW");
  }, 120_000);

  it("refuses generate() on the embedding model", async () => {
    const error = await embedder.generate({ prompt: "hi" }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isGgmlNodeError(error) && error.code).toBe("INVALID_OPTIONS");
  }, 120_000);
});
