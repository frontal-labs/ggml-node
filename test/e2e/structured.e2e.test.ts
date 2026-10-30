import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createInboard } from "../../src/index.js";

/**
 * M4 acceptance: 50 classification runs and 50 nested-extraction runs with the default model.
 * Every run must parse and validate. Opt-in: INBOARD_E2E=1.
 */
const enabled = process.env.INBOARD_E2E === "1";

const classification = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.enum(["low", "medium", "high"]),
});

const extraction = z.object({
  person: z.object({ name: z.string(), age: z.number().int() }),
  tags: z.array(z.string()),
  address: z.object({ city: z.string(), country: z.string() }).nullable(),
});

const reviews = Array.from({ length: 50 }, (_, i) =>
  i % 3 === 0
    ? `Review ${i}: the battery died after one day, very disappointed.`
    : i % 3 === 1
      ? `Review ${i}: arrived early and works exactly as described, great value.`
      : `Review ${i}: it is a box. It exists. No strong feelings either way.`,
);

const bios = Array.from(
  { length: 50 },
  (_, i) =>
    `Person ${i} is called Alex Chen${i}, is ${20 + (i % 40)} years old, lives in Lisbon, Portugal, and likes hiking and jazz.`,
);

describe.skipIf(!enabled)("e2e: structured output, 50 + 50 runs", () => {
  const ai = createInboard({ model: "qwen2.5-0.5b", maxConcurrency: 1 });

  it("classification: all 50 runs parse and validate", async () => {
    let valid = 0;
    for (const text of reviews) {
      const r = await ai.object({
        schema: classification,
        messages: [
          { role: "system", content: "Classify the review." },
          { role: "user", content: text },
        ],
        maxTokens: 96,
        temperature: 0.7,
      });
      if (classification.safeParse(r.object).success) valid += 1;
    }
    expect(valid).toBe(50);
  }, 900_000);

  it("nested extraction: all 50 runs parse and validate", async () => {
    let valid = 0;
    for (const text of bios) {
      const r = await ai.object({
        schema: extraction,
        messages: [
          { role: "system", content: "Extract the person's details." },
          { role: "user", content: text },
        ],
        maxTokens: 256,
        temperature: 0.7,
      });
      if (extraction.safeParse(r.object).success) valid += 1;
    }
    expect(valid).toBe(50);
  }, 900_000);
});
