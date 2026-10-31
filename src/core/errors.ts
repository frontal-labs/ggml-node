export const GGML_NODE_ERROR_CODES = [
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

export type GgmlNodeErrorCode = (typeof GGML_NODE_ERROR_CODES)[number];

export interface GgmlNodeErrorOptions {
  cause?: unknown;
  /** Actionable next step, e.g. "Run: npx ggml-node pull qwen2.5-0.5b". Must be non-empty. */
  hint: string;
}

export class GgmlNodeError extends Error {
  override readonly name = "GgmlNodeError";
  readonly code: GgmlNodeErrorCode;
  readonly hint: string;
  override readonly cause: unknown;

  constructor(code: GgmlNodeErrorCode, message: string, options: GgmlNodeErrorOptions) {
    super(message);
    this.code = code;
    this.hint = options.hint;
    this.cause = options.cause;
  }
}

export function isGgmlNodeError(e: unknown): e is GgmlNodeError {
  return e instanceof GgmlNodeError;
}
