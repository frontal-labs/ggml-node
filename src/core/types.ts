import type { TinyLLMError } from "@/core/errors.js";

import type { ModelId as RegistryModelId } from "@/registry/models.js";

export type ModelId = RegistryModelId;

export type Message =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export interface GenerateOptions {
  /** Default 256. */
  maxTokens?: number;
  messages?: Message[];
  /** Default "error". */
  overflow?: "error" | "truncate-start" | "truncate-middle";
  /** Exactly one of `prompt` or `messages` must be set. */
  prompt?: string;
  /** Deterministic sampling when set. */
  seed?: number;
  signal?: AbortSignal;
  stop?: string[];
  system?: string;
  /** Default 0.7. */
  temperature?: number;
  topK?: number;
  topP?: number;
}

export type FinishReason = "stop" | "length" | "abort";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface Timing {
  firstTokenMs: number;
  loadMs: number;
  queueMs: number;
  tokensPerSecond: number;
  totalMs: number;
}

export interface GenerateResult {
  finishReason: FinishReason;
  model: ModelId | "custom";
  text: string;
  timing: Timing;
  usage: Usage;
}

export interface StreamResult {
  abort: () => void;
  /** Resolves at end, same shape as `generate()`. */
  result: Promise<GenerateResult>;
  /** Text deltas. */
  textStream: AsyncIterable<string>;
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
  backend: "llama-cpp";
  contextSize: number;
  gpu: string | false;
  id: ModelId | "custom";
  license: string;
  path: string;
  sizeBytes: number;
}

export type TinyLLMEvent =
  | { type: "download:start"; model: ModelId; totalBytes: number }
  | { type: "download:progress"; model: ModelId; receivedBytes: number; totalBytes: number }
  | { type: "download:done"; model: ModelId; path: string }
  | { type: "load:start"; model: ModelId | "custom" }
  | { type: "load:done"; model: ModelId | "custom"; ms: number }
  | { type: "request:queued"; id: string; queueLength: number }
  | { type: "request:start"; id: string }
  | { type: "request:done"; id: string; result: Omit<GenerateResult, "text"> }
  | { type: "request:error"; id: string; error: TinyLLMError };

export type ModelSource = ModelId | { path: string };

export interface TinyLLMOptions {
  /** Required for models whose license is not Apache-2.0 or MIT. Default false. */
  acceptLicense?: boolean;
  /** Download lazily when the model is missing and not offline. Default true. */
  autoDownload?: boolean;
  /** Default: env TINY_LLM_CACHE_DIR, else the OS cache dir + /tiny-llm. */
  cacheDir?: string;
  /** Default: min(model.contextLength, 4096). */
  contextSize?: number;
  /** "auto" uses Metal/CUDA/Vulkan when available. */
  gpu?: "auto" | false;
  /** Default "none". */
  isolation?: "none" | "process";
  /** Parallel sequences. Default 1. */
  maxConcurrency?: number;
  /** Pending requests beyond concurrency. Overflow throws QUEUE_FULL. Default 64. */
  maxQueue?: number;
  /** A registry model id, or `{ path }` for a custom GGUF file. */
  model: ModelSource;
  /** Or env TINY_LLM_OFFLINE=1. Default false. */
  offline?: boolean;
  onEvent?: (event: TinyLLMEvent) => void;
  /** Number of threads, or "auto". */
  threads?: number | "auto";
}

export interface TinyLLM {
  countTokens: (text: string) => Promise<number>;
  generate: (options: GenerateOptions) => Promise<GenerateResult>;
  info: () => ModelInfo | null;
  /** Overloads: a Zod schema infers its output type. A JSON Schema object returns `unknown` unless `T` is given. */
  object: {
    <S extends ZodLikeSchema>(
      options: ObjectOptions<S>,
    ): Promise<ObjectResult<S["_zod"]["output"]>>;
    <T = unknown>(options: ObjectOptions<JsonSchemaObject>): Promise<ObjectResult<T>>;
  };
  /** Optional warm-up. Idempotent. Resolves with model info. */
  ready: () => Promise<ModelInfo>;
  stream: (options: GenerateOptions) => StreamResult;
  /** Frees memory. The next call reloads the model. */
  unload: () => Promise<void>;
}
