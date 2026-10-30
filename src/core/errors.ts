export const TINY_LLM_ERROR_CODES = [
  "MODEL_NOT_FOUND",
  "DOWNLOAD_FAILED",
  "CHECKSUM_MISMATCH",
  "LICENSE_NOT_ACCEPTED",
  "UNSUPPORTED_PLATFORM",
  "OUT_OF_MEMORY",
  "CONTEXT_OVERFLOW",
  "QUEUE_FULL",
  "ABORTED",
  "SCHEMA_VIOLATION",
  "INVALID_OPTIONS",
  "BACKEND_CRASHED",
] as const;

export type TinyLLMErrorCode = (typeof TINY_LLM_ERROR_CODES)[number];

export interface TinyLLMErrorOptions {
  cause?: unknown;
  /** Actionable next step, e.g. "Run: npx tiny-llm pull qwen2.5-0.5b". Must be non-empty. */
  hint: string;
}

export class TinyLLMError extends Error {
  override readonly name = "TinyLLMError";
  readonly code: TinyLLMErrorCode;
  readonly hint: string;
  override readonly cause: unknown;

  constructor(code: TinyLLMErrorCode, message: string, options: TinyLLMErrorOptions) {
    super(message);
    this.code = code;
    this.hint = options.hint;
    this.cause = options.cause;
  }
}

export function isTinyLLMError(e: unknown): e is TinyLLMError {
  return e instanceof TinyLLMError;
}
