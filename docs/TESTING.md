# Testing

## Your tests: `ggml-node/testing`

Use it in unit tests of code that calls ggml-node. It answers without a model, loads no native code, and returns the same shapes as the real thing.

```ts
import { createMockGgmlNode, mockModel } from "ggml-node/testing";
import { generateText } from "ai";

const ai = createMockGgmlNode({ respond: "a fixed answer" });
await ai.generate({ prompt: "anything" }); // { text: "a fixed answer", ... }

await generateText({ model: mockModel({ respond: "hi" }), prompt: "x" }); // "hi"
```

`respond` can be:

- a string: every reply is that string
- an array: replies come in order, and the list cycles when it runs out
- a function `({ messages }) => string`: the reply depends on the request

Other options: `delayMs` (pause before each chunk, for abort tests) and `tokensPerChunk` (words per streamed chunk).

`object()` parses the reply as JSON and checks it with your schema, so a mock can answer with JSON.

The mock counts tokens as whitespace-separated words. Its numbers are for testing only, not for benchmarks.

## This repository's suites

| Command | What it runs | Needs |
| --- | --- | --- |
| `bun run test` | `tests/unit`: 168 tests | nothing. No network, no real model. |
| `bun run test:e2e` | `tests/e2e`: real-model tests (generation, structured output, process isolation, embeddings) | `GGML_NODE_E2E=1`, the default model cached, and `bun run build` for the isolation suite. The embedding tests also need `GGML_NODE_EMBED_MODEL` set to an embedding GGUF file. |
| `bun run verify` | lint, typecheck, unit tests, build | nothing |

Unit tests use `tests/helpers/fixture-server.ts` for HTTP (a local server with Range support) and `tests/helpers/fake-backend.ts` for inference. A compile-time check of the public API lives in `tests/types/public-api.ts`, and `bun run typecheck` enforces it.

Process-isolation tests run the real worker protocol in a child process with a fake backend. A prompt containing `CRASH` kills the child, which exercises the crash path.

A test asserts that `ggml-node/testing` does not load `node-llama-cpp`. It runs the import in a child process with a loader hook that records native imports.

## Writing tests here

- Compare large buffers with `Buffer.compare`, not `toEqual`. Vitest's deep equality is slow on them.
- Do not assert on timing. Make the failure deterministic. The resume test uses a fetch that fails after 100 KB, not a socket trick.
- Real-model tests go in `tests/e2e` and check `env.GGML_NODE_E2E`.
