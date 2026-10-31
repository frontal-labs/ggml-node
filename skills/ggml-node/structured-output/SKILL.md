---
name: ggml-node-structured-output
description: Get a typed object from a local ggml-node model with object() and a Zod or JSON Schema. Covers the supported JSON Schema subset, the rejected keywords, and how to validate results.
---

# ggml-node-structured-output

`object()` generates JSON under a grammar, so the shape is guaranteed. The values still come from the model, so validate what matters.

```ts
import { z } from "zod";

const r = await ai.object({
  prompt: "Classify: 'The package arrived broken.'",
  schema: z.object({
    sentiment: z.enum(["positive", "negative", "neutral"]),
    confidence: z.enum(["low", "medium", "high"]),
  }),
  maxTokens: 64,
  temperature: 0,
});
r.object; // typed by the schema
```

## Rules

- Prefer Zod 4 schemas. They infer the result type. A plain JSON Schema returns `unknown` unless you pass a type argument.
- Use `z.enum` for classification. The grammar then only allows the listed labels.
- Keep schemas flat where you can. Nested objects work, but each level costs tokens.
- Raise `maxTokens` for nested or long output. A cut-off reply throws `SCHEMA_VIOLATION`.
- Do not add numeric bounds (`.min`, `.max`), regex patterns or non-date formats. They are rejected with `INVALID_OPTIONS` naming the keyword. Check those rules in your own code after the call.
- Zod's `.nullable()` and unions are accepted. Zod's `.int()` is accepted (its safe-integer bounds are dropped automatically).

## Supported JSON Schema

`type` (`string`, `number`, `integer`, `boolean`, `null`, `object`, `array`, or a list such as `["string","null"]`), `properties`, `required`, `additionalProperties`, `items`, `prefixItems`, `minItems`, `maxItems`, `minProperties`, `maxProperties`, `minLength`, `maxLength`, `enum`, `const`, `oneOf`, `format` (`date-time`, `time`, `date`), `$ref` into `#/$defs/`, `$defs`, and the annotations `description`, `title`, `$schema`.

Rejected: `minimum`, `maximum`, `multipleOf`, `pattern`, `anyOf` (use `oneOf`), other formats, and `$ref` outside `#/$defs/`.

## Validation

With Zod, `object` returns Zod's `safeParse` output, so transforms and defaults apply. A failure throws `SCHEMA_VIOLATION`. Catch it, retry once with a larger `maxTokens`, and then surface the error.

See `docs/STRUCTURED_OUTPUT.md` for the full subset.
