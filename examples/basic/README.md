# Basic example

The core API: `generate`, `stream`, and `unload`.

## Build and run

From the repository root:

```sh
bun run build
bun --filter '@ggml-node/example-basic' start
```

## Notes

- `createGgmlNode` requires a `model`. This example uses `qwen2.5-0.5b`, which `npx ggml-node pull qwen2.5-0.5b` downloads on first use.
- `stream` returns an async iterator over text deltas; `await s.result` gives the final result.
- `unload` frees the model; `ai.info()` returns `null` afterwards.
