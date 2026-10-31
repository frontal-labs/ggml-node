---
name: ggml-node-ai-sdk
description: Use a local ggml-node model through the Vercel AI SDK (generateText, streamText, generateObject) with the ggml-node/ai provider. Covers settings, what maps to what, and unsupported inputs.
---

# ggml-node-ai-sdk

```ts
import { generateText, streamText, generateObject } from "ai";
import { ggmlNode } from "ggml-node/ai";
import { z } from "zod";

const model = ggmlNode("qwen2.5-0.5b");

await generateText({ model, prompt: "Hello", maxOutputTokens: 64, temperature: 0 });
await generateObject({ model, schema: z.object({ n: z.number() }), prompt: "Pick a number" });
```

## Rules

- `ggml-node(modelId, settings?)` shares one loaded model per model and settings. Do not create a model per request.
- Settings are the `createGgmlNode` options except `model`. Use `createGgmlNodeProvider(settings)` for several models with the same settings.
- Text only in v1. Images and files are dropped with a warning. Tool calling is not supported. `toolChoice: "required"` throws `INVALID_OPTIONS`.
- `responseFormat: json` with a schema uses the same grammar path as `object()`. Without a schema, the output is not guaranteed, and the provider warns.
- Structured output streams as one delta, not token by token.
- Read the `warnings` array on results when a feature may have been dropped.

## Mapping

`maxOutputTokens` → `maxTokens`, `stopSequences` → `stop`, `abortSignal` → `signal`. `usage` reports real input and output token counts.

`ai` v7 marks `generateObject` and the `image` content part as deprecated. The code still works. Prefer `generateText` with an output setting in new code if the SDK version you use supports it.

See `docs/AI_SDK.md`.
