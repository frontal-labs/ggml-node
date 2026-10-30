# AI SDK example

LocalLLM with the AI SDK: `generateText`, `streamText`, and `generateObject`.

## Build and run

From the repository root:

```sh
bun run build
bun --filter '@local-llm/example-ai-sdk' start
```

## Notes

- Uses `local-llm` from `local-llm/ai` as an AI SDK model.
- Image input is not supported in v1; the provider warns and drops it instead of failing.
- `generateObject` requires a Zod schema.
