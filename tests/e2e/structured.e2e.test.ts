// biome-ignore-all lint/performance/noAwaitInLoops: the acceptance loops run one call at a time by design
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { env } from "@/env.js";
import { createInboard } from "@/index.js";

/**
 * M4 acceptance: 50 classification runs and 50 nested-extraction runs with the default model.
 * Every run must parse and validate. Opt-in: INBOARD_E2E=1.
 */
const enabled = env.INBOARD_E2E === "1";

const classification = z.object({
  confidence: z.enum(["low", "medium", "high"]),
  sentiment: z.enum(["positive", "negative", "neutral"]),
});

const extraction = z.object({
  address: z.object({ city: z.string(), country: z.string() }).nullable(),
  person: z.object({ age: z.number().int(), name: z.string() }),
  tags: z.array(z.string()),
});

const REVIEW_STYLES = [
  (i: number) => `Review ${i}: the battery died after one day, very disappointed.`,
  (i: number) => `Review ${i}: arrived early and works exactly as described, great value.`,
  (i: number) => `Review ${i}: it is a box. It exists. No strong feelings either way.`,
] as const;

const reviews = Array.from({ length: 50 }, (_, i) => REVIEW_STYLES[i % 3]?.(i) ?? "");

const bios = Array.from(
  { length: 50 },
  (_, i) =>
    `Person ${i} is called Alex Chen${i}, is ${20 + (i % 40)} years old, lives in Lisbon, Portugal, and likes hiking and jazz.`,
);

describe.skipIf(!enabled)("e2e: structured output, 50 + 50 runs", () => {
  const ai = createInboard({ maxConcurrency: 1, model: "qwen2.5-0.5b" });

  it("classification: all 50 runs parse and validate", async () => {
    let valid = 0;
    for (const text of reviews) {
      const r = await ai.object({
        maxTokens: 96,
        messages: [
          { content: "Classify the review.", role: "system" },
          { content: text, role: "user" },
        ],
        schema: classification,
        temperature: 0.7,
      });
      if (classification.safeParse(r.object).success) {
        valid += 1;
      }
    }
    expect(valid).toBe(50);
  }, 900_000);

  it("nested extraction: all 50 runs parse and validate", async () => {
    let valid = 0;
    for (const text of bios) {
      const r = await ai.object({
        maxTokens: 256,
        messages: [
          { content: "Extract the person's details.", role: "system" },
          { content: text, role: "user" },
        ],
        schema: extraction,
        temperature: 0.7,
      });
      if (extraction.safeParse(r.object).success) {
        valid += 1;
      }
    }
    expect(valid).toBe(50);
  }, 900_000);
});
