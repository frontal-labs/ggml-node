import { z } from "zod";
import type { GgmlNodeEvent } from "@/core/types.js";
import { MODEL_IDS, type ModelId } from "@/registry/models.js";

/**
 * Zod schemas for every public option surface. The inferred types are the source of truth for
 * `src/core/types.ts` consumers, and the schemas run at each boundary: `createGgmlNode`, each
 * generate call, and the CLI.
 */

export const modelIdSchema = z.enum(MODEL_IDS as [ModelId, ...ModelId[]]);

export const modelSourceSchema = z.union([modelIdSchema, z.object({ path: z.string().min(1) })]);

const eventListener = z.custom<(event: GgmlNodeEvent) => void>(
  (value) => typeof value === "function",
);

export const ggmlNodeOptionsSchema = z.object({
  acceptLicense: z.boolean().optional(),
  autoDownload: z.boolean().optional(),
  cacheDir: z.string().min(1).optional(),
  contextSize: z.number().int().positive().optional(),
  gpu: z.union([z.literal("auto"), z.literal(false)]).optional(),
  isolation: z.enum(["none", "process"]).optional(),
  kind: z.enum(["generation", "embedding"]).optional(),
  maxConcurrency: z.number().int().min(1).optional(),
  maxQueue: z.number().int().min(0).optional(),
  model: modelSourceSchema,
  offline: z.boolean().optional(),
  onEvent: eventListener.optional(),
  threads: z.union([z.number().int().min(1), z.literal("auto")]).optional(),
});

export const messageSchema = z.discriminatedUnion("role", [
  z.object({ content: z.string(), role: z.literal("system") }),
  z.object({ content: z.string(), role: z.literal("user") }),
  z.object({ content: z.string(), role: z.literal("assistant") }),
]);

export const generateOptionsSchema = z.object({
  maxTokens: z.number().int().min(1).optional(),
  messages: z.array(messageSchema).optional(),
  overflow: z.enum(["error", "truncate-start", "truncate-middle"]).optional(),
  prompt: z.string().optional(),
  seed: z.number().int().min(0).optional(),
  signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
  stop: z.array(z.string().min(1)).optional(),
  system: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topK: z.number().int().min(0).optional(),
  topP: z.number().gt(0).max(1).optional(),
});

const nonEmptyText = z.string().min(1, "must not be empty");

export const embedOptionsSchema = z.object({
  input: z.union([nonEmptyText, z.array(nonEmptyText).min(1, "must not be an empty list")]),
});

/** `pull` and `list` flags, as the CLI parses them. */
export const pullOptionsSchema = z.object({
  dir: z.string().min(1).optional(),
});

export const listOptionsSchema = z.object({
  json: z.boolean().default(false),
});

export type GgmlNodeOptionsInput = z.input<typeof ggmlNodeOptionsSchema>;
export type GenerateOptionsInput = z.input<typeof generateOptionsSchema>;
export type PullOptions = z.infer<typeof pullOptionsSchema>;
export type ListOptions = z.infer<typeof listOptionsSchema>;

/** First issue as a readable sentence, for `INVALID_OPTIONS` messages. */
export function firstIssue(error: z.ZodError): { path: string; message: string } {
  const [issue] = error.issues;
  const path = issue?.path.map(String).join(".") ?? "";
  return { message: issue?.message ?? "invalid value", path: path || "options" };
}
