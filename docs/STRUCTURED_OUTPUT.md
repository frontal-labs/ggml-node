# Structured output

`object()` and `responseFormat` with a schema make the model produce JSON that matches your schema. The output is generated under a grammar, so it always parses and always has the right shape. Then it is checked again against the schema.

```ts
import { z } from "zod";

const r = await ai.object({
  schema: z.object({
    name: z.string(),
    age: z.number().int(),
    tags: z.array(z.string()),
    address: z.object({ city: z.string(), country: z.string() }).nullable(),
  }),
  prompt: "Extract the person: Alex, 34, lives in Lisbon, Portugal.",
  maxTokens: 256,
});
r.object; // typed: { name: string; age: number; tags: string[]; address: {...} | null }
```

## Zod or JSON Schema

- A Zod 4 schema infers the result type. Zod's own JSON Schema conversion is used, so a Zod schema gets its types from the schema.
- A plain JSON Schema object returns `unknown`. Pass a type argument to type it: `ai.object<{ name: string }>({ schema })`.

Zod 3 schemas are not supported. Upgrade to Zod 4.

## Supported JSON Schema

The grammar builder enforces this subset:

- `type`: `string`, `number`, `integer`, `boolean`, `null`, `object`, `array`, or a list of them, such as `["string", "null"]`
- `properties`, `required`, `additionalProperties` (boolean or a schema)
- `items`, `prefixItems`, `minItems`, `maxItems`
- `minProperties`, `maxProperties`
- `minLength`, `maxLength`
- `enum`, `const`
- `oneOf`
- `format` for `date-time`, `time` and `date` only
- `$ref` into `#/$defs/`, and `$defs`
- annotations such as `description`, `title` and `$schema`, which are allowed and ignored

## What is rejected

A keyword the grammar cannot enforce is rejected with `INVALID_OPTIONS` at call time. The message names the keyword and where it is. It is never silently ignored.

Common cases:

- numeric bounds, such as `minimum`, `maximum` and `multipleOf`
- `pattern`, and string formats other than date and time, such as `email` or `uuid`
- `anyOf` (use `oneOf`)
- `$ref` to anything outside `#/$defs/`

Zod adds some keywords you did not write, so the adapter handles those:

- `anyOf` from `z.union` or `.nullable()` is rewritten to `oneOf` when the branches are different types.
- The safe-integer bounds that Zod adds to every `z.number().int()` are dropped. Every JavaScript integer is already inside them, so the grammar loses nothing.
- Any bound you wrote yourself, such as `z.number().min(0)`, is kept and rejected. Check it in your own code after the call, or remove it.

## Validation

The grammar guarantees the shape. After generation, the output is checked a second time:

- with a Zod schema, by `safeParse`. Zod's output (after transforms and defaults) is what you get back.
- with a plain JSON Schema, by the grammar's own validator.

A failure throws `SCHEMA_VIOLATION`. That is rare with a grammar. The usual cause is a `maxTokens` too small for the output, so the JSON was cut short.

## Prompting

The schema is added to the system prompt, so the model also knows what the fields mean. Write field names and descriptions as you would for a human reader. The grammar makes the shape correct, but the content quality comes from the model and the prompt.

## Measured reliability

On the default model, 100 real calls (50 classification and 50 nested extraction) all parsed and validated (`tests/e2e/structured.e2e.test.ts`). Content quality is a separate question, and small models make mistakes in content.
