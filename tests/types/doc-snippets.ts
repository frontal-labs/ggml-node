// biome-ignore-all lint/complexity/noVoid: a compile-only file, where `void` marks values as used
// biome-ignore-all lint/suspicious/useAwait: each function mirrors a documented snippet, which may not await
/**
 * Compile-time check that the snippets in the README and the docs use the real API. Each function
 * is exported so the typecheck sees it used, and none is called at runtime.
 */
import { generateText } from "ai";
import { createTinyLLM } from "tiny-llm";
import { tinyLLM } from "tiny-llm/ai";
import { createMockTinyLLM, mockModel } from "tiny-llm/testing";
import { z } from "zod";

export async function readmeQuickstart(): Promise<void> {
  const ai = createTinyLLM({ model: "qwen2.5-0.5b" });

  const { text } = await ai.generate({
    maxTokens: 64,
    prompt: "In one sentence, what is a river?",
  });
  const { object } = await ai.object({
    prompt: "Classify: 'The package arrived broken.'",
    schema: z.object({ sentiment: z.enum(["positive", "negative", "neutral"]) }),
  });
  await ai.unload();
  const check: [string, { sentiment: "positive" | "negative" | "neutral" }] = [text, object];
  void check;
}

export async function readmeAiSdk(): Promise<void> {
  const { text } = await generateText({ model: tinyLLM("qwen2.5-0.5b"), prompt: "Hello" });
  void text;
}

export async function readmeTesting(): Promise<void> {
  const ai = createMockTinyLLM({ respond: "a fixed answer" });
  void ai;
  void mockModel({ respond: "hi" });
}

export async function gettingStartedStream(): Promise<void> {
  const ai = createTinyLLM({ model: "qwen2.5-0.5b" });
  const s = ai.stream({ maxTokens: 64, prompt: "Name three rivers." });
  for await (const delta of s.textStream) {
    void delta;
  }
  const result = await s.result;
  void result.finishReason;
}
