# Structured example

Structured output with Zod: a classification and a nested extraction. The grammar guarantees the shape; Zod checks the values again.

## Build and run

From the repository root:

```sh
bun run build
bun --filter '@local-llm/example-structured' start
```

## Notes

- `ai.object` validates the Zod schema before generation and rejects unsupported keywords up front.
- Nested and nullable fields are supported.
- `unload` frees the model when you are done.
