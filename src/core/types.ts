import type { InboardError } from "@/core/errors.js";
import type { ModelId } from "@/registry/models.js";

export type { ModelId };

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export interface GenerateOptions {
  /** Exactly one of `prompt` or `messages` must be set. */
  prompt?: string;
  messages?: Message[];
  system?: string;
  /** Default 256. */
  maxTokens?: number;
  /** Default 0.7. */
  temperature?: number;
  topP?: number;
  topK?: number;
  /** Deterministic sampling when set. */
  seed?: number;
  stop?: string[];
  /** Default "error". */
  overflow?: "error" | "truncate-start" | "truncate-middle";
  signal?: AbortSignal;
}

export type FinishReason = "stop" | "length" | "abort";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface Timing {
  queueMs: number;
  loadMs: number;
  firstTokenMs: number;
  totalMs: number;
  tokensPerSecond: number;
}

export interface GenerateResult {
  text: string;
  finishReason: FinishReason;
  model: ModelId | "custom";
  usage: Usage;
  timing: Timing;
}

export interface StreamResult {
  /** Text deltas. */
  textStream: AsyncIterable<string>;
  /** Resolves at end, same shape as `generate()`. */
  result: Promise<GenerateResult>;
  abort(): void;
}

/**
 * A Zod 4 schema, matched structurally so the library does not import zod at
 * type level. `z.infer<S>` is `S["_zod"]["output"]`.
 */
export interface ZodLikeSchema<O = unknown> {
  readonly _zod: { readonly output: O };
}

/** A plain JSON Schema object. Output is `unknown` unless you pass a type argument. */
export type JsonSchemaObject = Readonly<Record<string, unknown>>;

export interface ObjectOptions<S> extends Omit<GenerateOptions, "stop"> {
  schema: S;
  schemaName?: string;
}

export interface ObjectResult<T> extends Omit<GenerateResult, "text"> {
  object: T;
  raw: string;
}

export interface ModelInfo {
  id: ModelId | "custom";
  path: string;
  sizeBytes: number;
  contextSize: number;
  license: string;
  backend: "llama-cpp";
  gpu: string | false;
}

export type InboardEvent =
  | { type: "download:start"; model: ModelId; totalBytes: number }
  | { type: "download:progress"; model: ModelId; receivedBytes: number; totalBytes: number }
  | { type: "download:done"; model: ModelId; path: string }
  | { type: "load:start"; model: ModelId | "custom" }
  | { type: "load:done"; model: ModelId | "custom"; ms: number }
  | { type: "request:queued"; id: string; queueLength: number }
  | { type: "request:start"; id: string }
  | { type: "request:done"; id: string; result: Omit<GenerateResult, "text"> }
  | { type: "request:error"; id: string; error: InboardError };

export type ModelSource = ModelId | { path: string };

export interface InboardOptions {
  /** A registry model id, or `{ path }` for a custom GGUF file. */
  model: ModelSource;
  /** Default: min(model.contextLength, 4096). */
  contextSize?: number;
  /** Parallel sequences. Default 1. */
  maxConcurrency?: number;
  /** Pending requests beyond concurrency. Overflow throws QUEUE_FULL. Default 64. */
  maxQueue?: number;
  /** Number of threads, or "auto". */
  threads?: number | "auto";
  /** "auto" uses Metal/CUDA/Vulkan when available. */
  gpu?: "auto" | false;
  /** Default "none". */
  isolation?: "none" | "process";
  /** Default: env INBOARD_CACHE_DIR, else the OS cache dir + /inboard. */
  cacheDir?: string;
  /** Or env INBOARD_OFFLINE=1. Default false. */
  offline?: boolean;
  /** Download lazily when the model is missing and not offline. Default true. */
  autoDownload?: boolean;
  /** Required for models whose license is not Apache-2.0 or MIT. Default false. */
  acceptLicense?: boolean;
  onEvent?: (event: InboardEvent) => void;
}

export interface Inboard {
  /** Optional warm-up. Idempotent. Resolves with model info. */
  ready(): Promise<ModelInfo>;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  stream(options: GenerateOptions): StreamResult;
  object<S extends ZodLikeSchema>(
    options: ObjectOptions<S>,
  ): Promise<ObjectResult<S["_zod"]["output"]>>;
  object<T = unknown>(options: ObjectOptions<JsonSchemaObject>): Promise<ObjectResult<T>>;
  countTokens(text: string): Promise<number>;
  info(): ModelInfo | null;
  /** Frees memory. The next call reloads the model. */
  unload(): Promise<void>;
}
