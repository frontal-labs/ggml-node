/**
 * LocalLLM with the AI SDK: generateText, streamText and generateObject.
 * Run from the repo root: `bun run build && bun --filter @local-llm/example-ai-sdk start`
 */
import { generateObject, generateText, streamText } from "ai";
import { localLLM } from "local-llm/ai";
import { z } from "zod";

const model = localLLM("qwen2.5-0.5b");

const text = await generateText({
  maxOutputTokens: 48,
  model,
  prompt: "What is the capital of France?",
  system: "Answer in one short sentence.",
  temperature: 0,
});
console.log("generateText:", text.text.trim());
console.log("  usage:", text.usage);

const stream = streamText({
  maxOutputTokens: 48,
  model,
  prompt: "Name three primary colours.",
  temperature: 0,
});
process.stdout.write("streamText: ");
for await (const delta of stream.textStream) {
  process.stdout.write(delta);
}
process.stdout.write("\n");

const sentiment = await generateObject({
  model,
  prompt: "Classify the sentiment: 'The package arrived broken and late.'",
  schema: z.object({
    confidence: z.enum(["low", "medium", "high"]),
    sentiment: z.enum(["positive", "negative", "neutral"]),
  }),
});
console.log("generateObject:", sentiment.object);

// Image input is not supported in v1. The provider warns and drops it, instead of failing.
const withImage = await generateText({
  maxOutputTokens: 16,
  messages: [
    {
      content: [
        { text: "Say hello.", type: "text" },
        { image: new Uint8Array([0, 1, 2]), type: "image" },
      ],
      role: "user",
    },
  ],
  model,
  temperature: 0,
});
console.log("with image (dropped):", withImage.text.trim());
console.log("warnings:", withImage.warnings);
