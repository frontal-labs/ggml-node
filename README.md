# Local LLM

![Frontal Banner](./banner.jpg)

An AI model SDK inside your Node process. No daemon, no API key, no port.

`tiny-llm` runs a small quantized language model in-process with [node-llama-cpp](https://github.com/withcatai/node-llama-cpp). It has a typed API, an [AI SDK](https://ai-sdk.dev) provider, and structured output constrained by a grammar, so the result always matches your schema.

```ts
import { createTinyLLM } from "tiny-llm";
import { z } from "zod";

const ai = createTinyLLM({ model: "qwen2.5-0.5b" });

const { text } = await ai.generate({ prompt: "In one sentence, what is a river?", maxTokens: 64 });

const { object } = await ai.object({
  schema: z.object({ sentiment: z.enum(["positive", "negative", "neutral"]) }),
  prompt: "Classify: 'The package arrived broken.'",
});

await ai.unload();
```

## Install

```sh
npm install tiny-llm
npx tiny-llm pull qwen2.5-0.5b   # 491 MB, verified by SHA-256
```

Requires Node.js 20 or later. macOS (Metal), Linux and Windows are supported, and a GPU is optional.

## Use it with the AI SDK

```ts
import { generateText } from "ai";
import { tinyLLM } from "tiny-llm/ai";

const { text } = await generateText({ model: tinyLLM("qwen2.5-0.5b"), prompt: "Hello" });
```

## Test without a model

```ts
import { createMockTinyLLM } from "tiny-llm/testing";

const ai = createMockTinyLLM({ respond: "a fixed answer" });
```

## Models

| Id | Size | Context | License |
| --- | --- | --- | --- |
| `qwen2.5-0.5b` (default) | 491 MB | 32768 | Apache-2.0 |
| `qwen2.5-1.5b` | 1.12 GB | 32768 | Apache-2.0 |
| `smollm2-360m` | 386 MB | 8192 | Apache-2.0 |

Any other GGUF file works through `createTinyLLM({ model: { path } })`.

## Command line

```sh
npx tiny-llm list                              # models and cache state
npx tiny-llm run "What is a river?"            # generate
npx tiny-llm run "Extract: Alex, 34" --json-schema person.json
npx tiny-llm bench qwen2.5-0.5b --tokens 128   # load, first token, tokens/s, memory
npx tiny-llm doctor                            # checks the machine and the backend
```

## Documentation

- [Getting started](./docs/getting-started.md)
- [API reference](./docs/api.md)
- [AI SDK provider](./docs/ai-sdk.md)
- [Structured output](./docs/structured-output.md)
- [Models](./docs/models.md) · [Configuration](./docs/configuration.md) · [CLI](./docs/cli.md)
- [Process isolation](./docs/isolation.md) · [Testing](./docs/testing.md) · [Deployment](./docs/deployment.md)
- [What tiny models are good at](./docs/what-tiny-models-are-good-at.md)
- [Benchmarks](./docs/benchmarks.md) · [Troubleshooting](./docs/troubleshooting.md)
- [Development](./docs/development.md)

Examples live in [`examples/`](./examples), and agent skills in [`skills/`](./skills).

## When not to use it

- You need the strongest model available. Hosted models are far more capable.
- You need reasoning, long documents, tool calling or world knowledge. Small models are weak at them. See [what tiny models are good at](./docs/what-tiny-models-are-good-at.md).
- You cannot spare about 1 GB of memory for the model and its cache.
- You run on zip-based serverless functions. The model and the native binary do not fit. Use a container image.

## Status

Version 0.1.0 is in development and has not been published to npm. The release process is described in [Development](./docs/development.md).

## License

Apache-2.0. See [LICENSE.md](./LICENSE.md).
