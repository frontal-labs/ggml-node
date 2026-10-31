---
name: ggml-node-usage
description: Use ggml-node to run a small local LLM inside a Node.js process. Covers createGgmlNode, generate, stream, errors, and when a local model is the right choice.
---

# ggml-node-usage

ggml-node runs a small quantized model in-process. There is no daemon, no API key and no port. Use it for classification, extraction, rewriting and short copy, on the user's machine or in a container. Do not use it for reasoning, facts or long-form writing.

## Minimal usage

```ts
import { createGgmlNode, isGgmlNodeError } from "ggml-node";

const ai = createGgmlNode({ model: "qwen2.5-0.5b" });
const { text, finishReason, usage } = await ai.generate({
  prompt: "In one sentence, what is a river?",
  maxTokens: 64,
  temperature: 0,
});
await ai.unload();
```

## Rules to follow

- Use a registry id (`qwen2.5-0.5b`, `qwen2.5-1.5b`, `smollm2-360m`). A custom GGUF uses `{ path }`.
- Models download on first use. If the app must not download at runtime, pull first (`npx ggml-node pull qwen2.5-0.5b`) and set `offline: true` or `LOCAL_LLM_OFFLINE=1`.
- Pass exactly one of `prompt` or `messages`. Put instructions in `system` or a system message.
- Set `maxTokens` for every call. The default is 256, and a short answer should not pay for more.
- Set `temperature: 0` for repeatable output. Add `seed` to make sampling repeatable too.
- Keep one `GgmlNode` per model for the life of the process. Creating one per request reloads the model.
- Call `ai.unload()` when the process is done with the model, or the memory stays allocated.
- Respect `maxConcurrency` (default 1) and `maxQueue` (default 64). Handle `QUEUE_FULL` with a retry or a 503.

## Errors

Every error is an `GgmlNodeError` with a `code` and a `hint`. Check with `isGgmlNodeError(err)`, then branch on `err.code`:

- `MODEL_NOT_FOUND`: pull the model, or copy it into the cache.
- `OUT_OF_MEMORY`: use a smaller model, or lower `contextSize` or `maxConcurrency`.
- `CONTEXT_OVERFLOW`: shorten the input, lower `maxTokens`, or set `overflow`.
- `ABORTED`: the signal fired. Not a failure.
- `BACKEND_CRASHED`: with `isolation: "process"`, retry (the next call restarts the backend).

Show the `hint` to the developer. It says what to do.

## Streaming

```ts
const s = ai.stream({ prompt, maxTokens: 128 });
for await (const delta of s.textStream) output.write(delta);
const result = await s.result;
```

`s.abort()` stops generation. `result` then resolves with `finishReason: "abort"` and the partial text.

## Deciding on isolation

Use `isolation: "process"` in apps where a native crash must not take the main process down (desktop apps, long-running servers). It costs a child process and a little latency on the first call. See `docs/ISOLATION.md`.
