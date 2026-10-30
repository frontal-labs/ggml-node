/**
 * Inboard with the AI SDK: generateText, streamText and generateObject.
 * Run from the repo root: `pnpm build && pnpm --filter @inboard/example-ai-sdk start`
 */
import { generateObject, generateText, streamText } from "ai";
import { inboard } from "inboard-sdk/ai";
import { z } from "zod";

const model = inboard("qwen2.5-0.5b");

const text = await generateText({
  model,
  system: "Answer in one short sentence.",
  prompt: "What is the capital of France?",
  maxOutputTokens: 48,
  temperature: 0,
});
console.log("generateText:", text.text.trim());
console.log("  usage:", text.usage);

const stream = streamText({
  model,
  prompt: "Name three primary colours.",
  maxOutputTokens: 48,
  temperature: 0,
});
process.stdout.write("streamText: ");
for await (const delta of stream.textStream) process.stdout.write(delta);
process.stdout.write("\n");

const sentiment = await generateObject({
  model,
  schema: z.object({
    sentiment: z.enum(["positive", "negative", "neutral"]),
    confidence: z.enum(["low", "medium", "high"]),
  }),
  prompt: "Classify the sentiment: 'The package arrived broken and late.'",
});
console.log("generateObject:", sentiment.object);

// Image input is not supported in v1. The provider warns and drops it, instead of failing.
const withImage = await generateText({
  model,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Say hello." },
        { type: "image", image: new Uint8Array([0, 1, 2]) },
      ],
    },
  ],
  maxOutputTokens: 16,
  temperature: 0,
});
console.log("with image (dropped):", withImage.text.trim());
console.log("warnings:", withImage.warnings);
