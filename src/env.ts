import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * The only place in the library that reads `process.env`. Every variable is declared here, so
 * a typo or a malformed value fails loudly at startup instead of changing behaviour silently.
 *
 * Values are strings, because they come straight from the environment. Parsing into booleans or
 * paths happens where each value is used, through the schemas exported below.
 */
export const envSchema = {
  INBOARD_CACHE_DIR: z.string().min(1).optional(),
  /** Test-only switch. Enables the real-model suites under `tests/e2e`. */
  INBOARD_E2E: z.string().optional(),
  INBOARD_OFFLINE: z.string().optional(),
  LOCALAPPDATA: z.string().min(1).optional(),
  XDG_CACHE_HOME: z.string().min(1).optional(),
} as const;

export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: envSchema,
});

/** The environment shape, with every variable optional. Functions accept this so tests can inject one. */
export type InboardEnv = Partial<{ [K in keyof typeof envSchema]: string | undefined }>;

/** Accepts the usual boolean spellings: 1/0, true/false, yes/no, on/off. */
export const flagSchema = z.stringbool();
