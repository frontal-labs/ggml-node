import { z } from "zod";
import type { InboardEvent } from "@/core/types.js";
import { MODEL_IDS, type ModelId } from "@/registry/models.js";

/**
 * Zod schemas for every public option surface. The inferred types are the source of truth for
 * `src/core/types.ts` consumers, and the schemas run at each boundary: `createInboard`, each
 * generate call, and the CLI.
 */

export const modelIdSchema = z.enum(MODEL_IDS as [ModelId, ...ModelId[]]);

export const modelSourceSchema = z.union([modelIdSchema, z.object({ path: z.string().min(1) })]);

const eventListener = z.custom<(event: InboardEvent) => void>(
  (value) => typeof value === "function",
);

export const inboardOptionsSchema = z.object({
  model: modelSourceSchema,
  contextSize: z.number().int().positive().optional(),
  maxConcurrency: z.number().int().min(1).optional(),
  maxQueue: z.number().int().min(0).optional(),
  threads: z.union([z.number().int().min(1), z.literal("auto")]).optional(),
  gpu: z.union([z.literal("auto"), z.literal(false)]).optional(),
  isolation: z.enum(["none", "process"]).optional(),
  cacheDir: z.string().min(1).optional(),
  offline: z.boolean().optional(),
  autoDownload: z.boolean().optional(),
  acceptLicense: z.boolean().optional(),
  onEvent: eventListener.optional(),
});

export const messageSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("system"), content: z.string() }),
  z.object({ role: z.literal("user"), content: z.string() }),
  z.object({ role: z.literal("assistant"), content: z.string() }),
]);

export const generateOptionsSchema = z.object({
  prompt: z.string().optional(),
  messages: z.array(messageSchema).optional(),
  system: z.string().optional(),
  maxTokens: z.number().int().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().gt(0).max(1).optional(),
  topK: z.number().int().min(0).optional(),
  seed: z.number().int().min(0).optional(),
  stop: z.array(z.string().min(1)).optional(),
  overflow: z.enum(["error", "truncate-start", "truncate-middle"]).optional(),
  signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
});

/** `pull` and `list` flags, as the CLI parses them. */
export const pullOptionsSchema = z.object({
  dir: z.string().min(1).optional(),
});

export const listOptionsSchema = z.object({
  json: z.boolean().default(false),
});

export type InboardOptionsInput = z.input<typeof inboardOptionsSchema>;
export type GenerateOptionsInput = z.input<typeof generateOptionsSchema>;
export type PullOptions = z.infer<typeof pullOptionsSchema>;
export type ListOptions = z.infer<typeof listOptionsSchema>;

/** First issue as a readable sentence, for `INVALID_OPTIONS` messages. */
export function firstIssue(error: z.ZodError): { path: string; message: string } {
  const issue = error.issues[0];
  const path = issue?.path.map(String).join(".") ?? "";
  return { path: path || "options", message: issue?.message ?? "invalid value" };
}
