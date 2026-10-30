# Getting started

## Requirements

- Node.js 20 or later (22 or 24 recommended). Bun is used for development, not by the published package.
- About 1 GB of free disk for the default model, and about 1 GB of free memory while it runs.
- macOS (Apple Silicon uses Metal), Linux, or Windows. A GPU is optional.

## Install

```sh
npm install inboard-sdk
```

## Pull a model

The default model is `qwen2.5-0.5b` (Qwen2.5 0.5B Instruct, Q4_K_M, Apache-2.0, 491 MB). Installing the package downloads nothing. Models download on first use, or explicitly:

```sh
npx inboard pull qwen2.5-0.5b
```

The download resumes if interrupted, and the file is verified against its SHA-256 before it is used.

## Generate

```ts
import { createInboard } from "inboard-sdk";

const ai = createInboard({ model: "qwen2.5-0.5b" });

const { text } = await ai.generate({
  prompt: "In one sentence, what is a river?",
  maxTokens: 64,
  temperature: 0,
});
console.log(text);

await ai.unload(); // frees the model when you are done
```

The first call loads the model. Later calls reuse it. Call `ai.ready()` before the first request if you want the load to happen at startup.

## Stream

```ts
const s = ai.stream({ prompt: "Name three rivers.", maxTokens: 64 });
for await (const delta of s.textStream) process.stdout.write(delta);
const result = await s.result; // same shape as generate()
```

## Structured output

```ts
import { z } from "zod";

const sentiment = await ai.object({
  schema: z.object({
    sentiment: z.enum(["positive", "negative", "neutral"]),
    confidence: z.enum(["low", "medium", "high"]),
  }),
  prompt: "Classify: 'The package arrived broken.'",
});
console.log(sentiment.object); // typed from the schema
```

See [structured output](./structured-output.md) for what the grammar guarantees and which keywords are rejected.

## Use it with the AI SDK

```ts
import { generateText } from "ai";
import { inboard } from "inboard-sdk/ai";

const { text } = await generateText({ model: inboard("qwen2.5-0.5b"), prompt: "Hello" });
```

See [AI SDK provider](./ai-sdk.md).

## Next steps

- Read the [API reference](./api.md) for every option and error code.
- Try the [examples](../examples): `bun --filter '@inboard/example-basic' start`.
- If something fails, run `npx inboard doctor` first. See [troubleshooting](./troubleshooting.md).
