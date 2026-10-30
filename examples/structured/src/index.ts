/**
 * Structured output with Zod: a classification and a nested extraction. The grammar guarantees the
 * shape. Zod checks the values again. Run from the repo root:
 *   bun run build && bun --filter '@inboard/example-structured' start
 */
import { createInboard } from "inboard-sdk";
import { z } from "zod";

const ai = createInboard({ model: "qwen2.5-0.5b" });

const review = z.object({
  confidence: z.enum(["low", "medium", "high"]),
  sentiment: z.enum(["positive", "negative", "neutral"]),
});

const person = z.object({
  address: z.object({ city: z.string(), country: z.string() }).nullable(),
  age: z.number().int(),
  name: z.string(),
  tags: z.array(z.string()),
});

const classified = await ai.object({
  prompt: "Classify this review: 'The battery died after one day.'",
  schema: review,
  temperature: 0,
});
console.log("classification:", classified.object);

const extracted = await ai.object({
  maxTokens: 256,
  prompt: "Extract the person: Alex Chen, 34, lives in Lisbon, Portugal. Likes hiking and jazz.",
  schema: person,
  temperature: 0,
});
console.log("extraction:", extracted.object);

// A keyword the grammar cannot enforce is rejected before any generation runs.
try {
  await ai.object({
    prompt: "x",
    schema: { properties: { n: { minimum: 0, type: "number" } }, type: "object" },
  });
} catch (err) {
  console.log("rejected as expected:", err instanceof Error ? err.message : err);
}

await ai.unload();
