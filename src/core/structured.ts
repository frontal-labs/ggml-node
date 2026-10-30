import { InboardError } from "./errors.js";
import type { JsonSchemaObject, Message, ZodLikeSchema } from "./types.js";

/**
 * Structured output. A Zod schema or a plain JSON Schema is compiled into a grammar, so the model
 * can only produce JSON that matches it. The grammar guarantees the shape. Validation afterwards
 * is a second check, and the schema instruction in the prompt is there to improve the content.
 */

/** Keywords the grammar builder accepts. Anything else is rejected at call time, never ignored. */
const SUPPORTED_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "minProperties",
  "maxProperties",
  "minLength",
  "maxLength",
  "format",
  "enum",
  "const",
  "oneOf",
  "$ref",
  "$defs",
]);

/** Annotations that do not change what is accepted. They are allowed and stripped. */
const ANNOTATION_KEYWORDS = new Set([
  "description",
  "title",
  "$schema",
  "$id",
  "examples",
  "default",
]);

const SUPPORTED_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "null",
  "object",
  "array",
]);
const SUPPORTED_FORMATS = new Set(["date-time", "time", "date"]);

export function isZodLike(schema: unknown): schema is ZodLikeSchema {
  return typeof schema === "object" && schema !== null && "_zod" in schema;
}

/**
 * Converts a Zod 4 schema to JSON Schema with Zod's own converter. The `zod` package is loaded
 * here, on first use, so it stays an optional peer. `anyOf` is rewritten to `oneOf`, which the
 * grammar builder supports, when its branches are type-distinct.
 */
export async function zodToJsonSchema(schema: ZodLikeSchema): Promise<JsonSchemaObject> {
  let zod: typeof import("zod");
  try {
    zod = await import("zod");
  } catch (err) {
    throw new InboardError("INVALID_OPTIONS", "A Zod schema was passed, but zod is not installed", {
      hint: "Install zod (npm i zod), or pass a plain JSON Schema object instead.",
      cause: err,
    });
  }
  if (typeof zod.toJSONSchema !== "function") {
    throw new InboardError("INVALID_OPTIONS", "Only Zod 4 schemas are supported", {
      hint: "Upgrade to zod 4, or pass a plain JSON Schema object.",
    });
  }
  const converted = zod.toJSONSchema(schema as unknown as Parameters<typeof zod.toJSONSchema>[0], {
    io: "output",
  }) as Record<string, unknown>;
  const { $schema: _dropped, ...rest } = converted;
  return rewriteAnyOf(rest) as JsonSchemaObject;
}

const SAFE_INT_MIN = -9007199254740991;
const SAFE_INT_MAX = 9007199254740991;

/**
 * Rewrites Zod's output into the grammar's subset. `anyOf` becomes `oneOf`. For `integer`, the
 * safe-integer bounds Zod adds to every integer are dropped, because every JS integer is already
 * inside them. Any other bound is kept, so it is still rejected as unsupported.
 */
function rewriteAnyOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteAnyOf);
  if (typeof value !== "object" || value === null) return value;

  const node = { ...(value as Record<string, unknown>) };
  if (Array.isArray(node.anyOf)) {
    node.oneOf = node.anyOf;
    delete node.anyOf;
  }
  if (node.type === "integer" && node.minimum === SAFE_INT_MIN && node.maximum === SAFE_INT_MAX) {
    delete node.minimum;
    delete node.maximum;
  }
  for (const key of Object.keys(node)) {
    node[key] = rewriteAnyOf(node[key]);
  }
  return node;
}

/**
 * Throws `INVALID_OPTIONS` naming the first keyword the grammar cannot enforce. Walks every
 * subschema, including `$defs`.
 */
export function assertSupportedSchema(schema: JsonSchemaObject): void {
  walk(schema, "#");
}

function walk(node: unknown, path: string): void {
  if (typeof node === "boolean") return;
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    throw unsupported(path, "a schema must be an object");
  }
  const record = node as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (ANNOTATION_KEYWORDS.has(key)) continue;
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw unsupported(
        `${path}/${key}`,
        `the "${key}" keyword is not supported by the grammar builder`,
      );
    }
  }

  if ("type" in record) {
    const types = Array.isArray(record.type) ? record.type : [record.type];
    for (const t of types) {
      if (typeof t !== "string" || !SUPPORTED_TYPES.has(t)) {
        throw unsupported(`${path}/type`, `type ${JSON.stringify(t)} is not supported`);
      }
    }
  }
  if (
    "format" in record &&
    (typeof record.format !== "string" || !SUPPORTED_FORMATS.has(record.format))
  ) {
    throw unsupported(`${path}/format`, "only the date-time, time and date formats are supported");
  }
  if ("additionalProperties" in record && typeof record.additionalProperties !== "boolean") {
    walk(record.additionalProperties, `${path}/additionalProperties`);
  }
  if (
    "$ref" in record &&
    (typeof record.$ref !== "string" || !record.$ref.startsWith("#/$defs/"))
  ) {
    throw unsupported(`${path}/$ref`, "references must point into #/$defs/");
  }

  if (isRecord(record.properties)) {
    for (const [name, sub] of Object.entries(record.properties)) {
      walk(sub, `${path}/properties/${name}`);
    }
  }
  if ("items" in record) walk(record.items, `${path}/items`);
  if (Array.isArray(record.prefixItems)) {
    record.prefixItems.forEach((sub, i) => {
      walk(sub, `${path}/prefixItems/${i}`);
    });
  }
  if (Array.isArray(record.oneOf)) {
    record.oneOf.forEach((sub, i) => {
      walk(sub, `${path}/oneOf/${i}`);
    });
  }
  if (isRecord(record.$defs)) {
    for (const [name, sub] of Object.entries(record.$defs)) {
      walk(sub, `${path}/$defs/${name}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unsupported(path: string, reason: string): InboardError {
  return new InboardError("INVALID_OPTIONS", `Unsupported JSON Schema at ${path}: ${reason}`, {
    hint: "Remove the unsupported constraint (for example a numeric minimum or a regex pattern), or validate that rule in your own code after the call.",
  });
}

/**
 * Adds the schema to the system prompt. If there is already a system message, the instruction is
 * appended to it. Otherwise a new system message is added at the front.
 */
export function withSchemaInstruction(
  messages: Message[],
  schema: JsonSchemaObject,
  schemaName?: string,
): Message[] {
  const label = schemaName ? ` named "${schemaName}"` : "";
  const instruction = `Reply with only a JSON value that matches the JSON Schema${label} below. Do not add any other text.\n${JSON.stringify(schema)}`;
  const [first, ...rest] = messages;
  if (first?.role === "system") {
    return [{ role: "system", content: `${first.content}\n\n${instruction}` }, ...rest];
  }
  return [{ role: "system", content: instruction }, ...messages];
}

/** Maps a parse or validation failure to `SCHEMA_VIOLATION`. */
export function schemaViolation(detail: string, cause?: unknown): InboardError {
  return new InboardError(
    "SCHEMA_VIOLATION",
    `The model output did not match the schema: ${detail}`,
    {
      hint: "Raise maxTokens if the output was cut short, or simplify the schema.",
      cause,
    },
  );
}
