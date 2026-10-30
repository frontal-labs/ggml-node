export const INBOARD_ERROR_CODES = [
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

export type InboardErrorCode = (typeof INBOARD_ERROR_CODES)[number];

export interface InboardErrorOptions {
  /** Actionable next step, e.g. "Run: npx inboard pull qwen2.5-0.5b". Must be non-empty. */
  hint: string;
  cause?: unknown;
}

export class InboardError extends Error {
  override readonly name = "InboardError";
  readonly code: InboardErrorCode;
  readonly hint: string;
  override readonly cause: unknown;

  constructor(code: InboardErrorCode, message: string, options: InboardErrorOptions) {
    super(message);
    this.code = code;
    this.hint = options.hint;
    this.cause = options.cause;
  }
}

export function isInboardError(e: unknown): e is InboardError {
  return e instanceof InboardError;
}
