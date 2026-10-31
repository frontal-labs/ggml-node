# GGML Node

![Frontal Banner](./banner.jpg)

An AI model SDK inside your Node process. No daemon, no API key, no port.

`ggml-node` runs a small quantized language model in-process with [node-llama-cpp](https://github.com/withcatai/node-llama-cpp). It has a typed API, an [AI SDK](https://ai-sdk.dev) provider, and structured output constrained by a grammar, so the result always matches your schema.

## What SLM means

SLM stands for **small language model**: a language model with a few hundred million to a few billion parameters, small enough to run on a laptop instead of a data centre. The default model, `qwen2.5-0.5b`, has 0.5 billion parameters and is 491 MB on disk. `ggml-node` runs these models inside your own Node.js process, on ggml, the C library behind llama.cpp.

```ts
import { createGgmlNode } from "ggml-node";
import { z } from "zod";

const ai = createGgmlNode({ model: "qwen2.5-0.5b" });

const { text } = await ai.generate({ prompt: "In one sentence, what is a river?", maxTokens: 64 });

const { object } = await ai.object({
  schema: z.object({ sentiment: z.enum(["positive", "negative", "neutral"]) }),
  prompt: "Classify: 'The package arrived broken.'",
});

await ai.unload();
```

## Install

```sh
npm install ggml-node
npx ggml-node pull qwen2.5-0.5b   # 491 MB, verified by SHA-256
```

Requires Node.js 20 or later. macOS (Metal), Linux and Windows are supported, and a GPU is optional.

## Use it with the AI SDK

```ts
import { generateText } from "ai";
import { ggmlNode } from "ggml-node/ai";

const { text } = await generateText({ model: ggmlNode("qwen2.5-0.5b"), prompt: "Hello" });
```

## Test without a model

```ts
import { createMockGgmlNode } from "ggml-node/testing";

const ai = createMockGgmlNode({ respond: "a fixed answer" });
```

## Models

| Id | Size | Context | License |
| --- | --- | --- | --- |
| `qwen2.5-0.5b` (default) | 491 MB | 32768 | Apache-2.0 |
| `qwen2.5-1.5b` | 1.12 GB | 32768 | Apache-2.0 |
| `smollm2-360m` | 386 MB | 8192 | Apache-2.0 |

Any other GGUF file works through `createGgmlNode({ model: { path } })`.

## Embeddings

An embedding model turns text into vectors for search and similarity. `bge-small-en-v1.5` is in the registry (384 dimensions, MIT). Call `embed` on it:

```ts
const embedder = createGgmlNode({ model: "bge-small-en-v1.5" });
const { embeddings, dimensions } = await embedder.embed({
  input: ["a cat on a mat", "a kitten on a rug"],
});
```

Any other embedding GGUF works through `{ path }`. Each handle holds one model: `generate` needs a generation model, and `embed` needs an embedding model. With the AI SDK, use `ggmlEmbedding("bge-small-en-v1.5")`. See [models](docs/MODELS.md#embedding-models) and [the AI SDK provider](docs/AI_SDK.md#embeddings).

## Command line

```sh
npx ggml-node list                              # models and cache state
npx ggml-node run "What is a river?"            # generate
npx ggml-node run "Extract: Alex, 34" --json-schema person.json
npx ggml-node bench qwen2.5-0.5b --tokens 128   # load, first token, tokens/s, memory
npx ggml-node doctor                            # checks the machine and the backend
```

## Documentation

- [Getting started](./docs/GETTING_STARTED.md)
- [API reference](./docs/API.md)
- [AI SDK provider](./docs/AI_SDK.md)
- [Structured output](./docs/STRUCTURED_OUTPUT.md)
- [Models](./docs/MODELS.md) · [Configuration](./docs/CONFIGURATION.md) · [CLI](./docs/CLI.md)
- [Process isolation](./docs/ISOLATION.md) · [Testing](./docs/TESTING.md) · [Deployment](./docs/DEPLOYMENT.md)
- [Benchmarks](./BENCHMARKS.md) · [Troubleshooting](./docs/TROUBLESHOOTING.md)
- [Development](./docs/DEVELOPMENT.md)

Examples live in [`examples/`](./examples), and agent skills in [`skills/`](./skills/ggml-node).

## When not to use it

- You need the strongest model available. Hosted models are far more capable.
- You need reasoning, long documents, tool calling or world knowledge. Small models are weak at them.
- You cannot spare about 1 GB of memory for the model and its cache.
- You run on zip-based serverless functions. The model and the native binary do not fit. Use a container image.

## Status

Version 0.2.0 is published to npm as `ggml-node`. The release process is described in [Development](./docs/DEVELOPMENT.md).

## License

Apache-2.0. See [LICENSE.md](./LICENSE.md).
