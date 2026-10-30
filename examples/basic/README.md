# Basic example

The core API: `generate`, `stream`, and `unload`.

## Build and run

From the repository root:

```sh
bun run build
bun --filter '@local-llm/example-basic' start
```

## Notes

- `createLocalLLM` requires a `model`. This example uses `qwen2.5-0.5b`, which `npx local-llm pull qwen2.5-0.5b` downloads on first use.
- `stream` returns an async iterator over text deltas; `await s.result` gives the final result.
- `unload` frees the model; `ai.info()` returns `null` afterwards.
