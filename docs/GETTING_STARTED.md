# Getting started

## Requirements

- Node.js 20 or later (22 or 24 recommended). Bun is used for development, not by the published package.
- About 1 GB of free disk for the default model, and about 1 GB of free memory while it runs.
- macOS (Apple Silicon uses Metal), Linux, or Windows. A GPU is optional.

## Install

```sh
npm install node-slm
```

`node-slm` has no install script of its own. Its native dependency, `node-llama-cpp`, runs its own `postinstall`, which checks the native binary for your platform. Nothing downloads a model at install time.

`zod` is a dependency of `node-slm`. Add it to your own project as well if you write schemas: `npm install zod`.

## Pull a model

The default model is `qwen2.5-0.5b` (Qwen2.5 0.5B Instruct, Q4_K_M, Apache-2.0, 491 MB). Installing the package downloads nothing. Models download on first use, or explicitly:

```sh
npx node-slm pull qwen2.5-0.5b
```

The download resumes if interrupted, and the file is verified against its SHA-256 before it is used.

## Generate

```ts
import { createNodeSlm } from "node-slm";

const ai = createNodeSlm({ model: "qwen2.5-0.5b" });

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

See [structured output](./STRUCTURED_OUTPUT.md) for what the grammar guarantees and which keywords are rejected.

## Use it with the AI SDK

```ts
import { generateText } from "ai";
import { nodeSlm } from "node-slm/ai";

const { text } = await generateText({ model: nodeSlm("qwen2.5-0.5b"), prompt: "Hello" });
```

See [AI SDK provider](./AI_SDK.md).

## Next steps

- Read the [API reference](./API.md) for every option and error code.
- Try the [examples](../examples): `bun --filter '@node-slm/example-basic' start`.
- If something fails, run `npx node-slm doctor` first. See [troubleshooting](./TROUBLESHOOTING.md).
