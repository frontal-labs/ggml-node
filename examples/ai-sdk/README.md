# AI SDK example

Inboard with the AI SDK: `generateText`, `streamText`, and `generateObject`.

## Build and run

From the repository root:

```sh
bun run build
bun --filter '@inboard/example-ai-sdk' start
```

## Notes

- Uses `inboard` from `inboard-sdk/ai` as an AI SDK model.
- Image input is not supported in v1; the provider warns and drops it instead of failing.
- `generateObject` requires a Zod schema.
