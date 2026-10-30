# AI SDK provider

`tiny-llm/ai` is a provider for [the AI SDK](https://ai-sdk.dev) (spec v4, `@ai-sdk/provider` 4.x). It works with `generateText`, `streamText` and `generateObject`.

```ts
import { generateText, streamText, generateObject } from "ai";
import { tiny-llm, createTinyLLMProvider } from "tiny-llm/ai";
import { z } from "zod";

const model = tinyLLM("qwen2.5-0.5b");

await generateText({ model, prompt: "Hello", maxOutputTokens: 64, temperature: 0 });

const stream = streamText({ model, prompt: "Name three colours." });
for await (const delta of stream.textStream) process.stdout.write(delta);

await generateObject({
  model,
  schema: z.object({ sentiment: z.enum(["positive", "negative", "neutral"]) }),
  prompt: "Classify: 'great value'",
});
```

## Choosing a model and settings

`tiny-llm(modelId, settings?)` takes the same settings as `createTinyLLM`, except `model`:

```ts
const local = tinyLLM("qwen2.5-0.5b", { maxConcurrency: 2, cacheDir: "./models" });
```

Calls with the same model and settings share one loaded instance. The model loads once per process.

For several settings sets, or for a provider you configure in one place, use `createTinyLLMProvider`:

```ts
const provider = createTinyLLMProvider({ maxConcurrency: 2 });
const model = provider.languageModel("qwen2.5-0.5b"); // or provider("qwen2.5-0.5b")
```

`onEvent` is not part of the sharing key, because functions cannot be compared. Two calls that differ only in their callback share one instance.

## What maps to what

| AI SDK | tiny-llm |
| --- | --- |
| `maxOutputTokens` | `maxTokens` |
| `temperature`, `topP`, `topK`, `seed` | the same |
| `stopSequences` | `stop` |
| `abortSignal` | `signal` |
| `responseFormat: { type: "json", schema }` | `object()`, grammar-constrained |
| `usage` | the real input and output token counts |

## Unsupported input

v1 is text-only, with no tool calling. Unsupported parts are dropped, and the provider reports a warning instead of failing:

- images and files (`feature: "file or image input"`)
- tool definitions (`feature: "tools"`) and tool calls or results (`feature: "tool calls"`, `"tool results"`)
- `responseFormat: json` without a schema (`feature: "responseFormat without schema"`). The model is asked for JSON in the prompt, but the output is not guaranteed. Pass a schema for a guarantee.

`toolChoice: "required"` or `"tool"` throws `INVALID_OPTIONS`, because a tool call cannot be honoured in v1. `"auto"` and `"none"` are accepted.

Warnings come back in the result's `warnings` array, as the SDK defines them.

## Streaming and structured output

A text stream yields deltas as they are generated. A structured response (`generateObject`, or `responseFormat` with a schema) is not streamed token by token. The whole object arrives as one delta, because the grammar path has no streaming variant in v1.

## Abort

`abortSignal` stops generation. An aborted stream finishes with `finishReason` `"other"` (raw value `"abort"`).

## Example

See [examples/ai-sdk](../examples/ai-sdk). It runs all three SDK functions and shows a warning for an image part.

Note: `ai` v7 marks `generateObject` and the `image` content part as deprecated. The example uses them because the plan asks for them, and the warnings are harmless. Moving to `generateText` with an output setting is a follow-up.
