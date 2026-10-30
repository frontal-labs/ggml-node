export const LOCAL_LLM_ERROR_CODES = [
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

export type LocalLLMErrorCode = (typeof LOCAL_LLM_ERROR_CODES)[number];

export interface LocalLLMErrorOptions {
  cause?: unknown;
  /** Actionable next step, e.g. "Run: npx local-llm pull qwen2.5-0.5b". Must be non-empty. */
  hint: string;
}

export class LocalLLMError extends Error {
  override readonly name = "LocalLLMError";
  readonly code: LocalLLMErrorCode;
  readonly hint: string;
  override readonly cause: unknown;

  constructor(code: LocalLLMErrorCode, message: string, options: LocalLLMErrorOptions) {
    super(message);
    this.code = code;
    this.hint = options.hint;
    this.cause = options.cause;
  }
}

export function isLocalLLMError(e: unknown): e is LocalLLMError {
  return e instanceof LocalLLMError;
}
