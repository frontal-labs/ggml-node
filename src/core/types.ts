import type { GgmlNodeError } from "@/core/errors.js";

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
 * `generate`, `stream` and `object` need a `generation` model. `embed` needs an `embedding` model.
 * A model's kind comes from its GGUF metadata, and `GgmlNodeOptions.kind` can override it.
 */
export type ModelKind = "generation" | "embedding";

export interface EmbedOptions {
  /** One text, or a batch. Each input is embedded on its own, and results keep the input order. */
  input: string | string[];
  /** Aborts while the request waits in the queue. A batch that is already running finishes its current input. */
  signal?: AbortSignal;
}

export interface EmbedUsage {
  /** Tokens evaluated for all inputs, including the special tokens the model adds. */
  inputTokens: number;
  totalTokens: number;
}

export interface EmbedTiming {
  /** Time spent loading the model in this call, else 0. */
  loadMs: number;
  /** Time waiting for a free slot. */
  queueMs: number;
  totalMs: number;
}

export interface EmbedResult {
  /** Length of every vector. Same as `ModelInfo.dimensions`. */
  dimensions: number;
  /** One vector per input, in input order. */
  embeddings: number[][];
  model: ModelId | "custom";
  timing: EmbedTiming;
  usage: EmbedUsage;
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
  /** Length of each embedding vector. Set only for an `embedding` model. */
  dimensions?: number;
  gpu: string | false;
  id: ModelId | "custom";
  kind: ModelKind;
  license: string;
  path: string;
  sizeBytes: number;
}

export type GgmlNodeEvent =
  | { type: "download:start"; model: ModelId; totalBytes: number }
  | { type: "download:progress"; model: ModelId; receivedBytes: number; totalBytes: number }
  | { type: "download:done"; model: ModelId; path: string }
  | { type: "load:start"; model: ModelId | "custom" }
  | { type: "load:done"; model: ModelId | "custom"; ms: number }
  | { type: "request:queued"; id: string; queueLength: number }
  | { type: "request:start"; id: string }
  | { type: "request:done"; id: string; result: Omit<GenerateResult, "text"> }
  | { type: "embed:done"; id: string; result: Omit<EmbedResult, "embeddings"> }
  | { type: "request:error"; id: string; error: GgmlNodeError };

export type ModelSource = ModelId | { path: string };

export interface GgmlNodeOptions {
  /** Required for models whose license is not Apache-2.0 or MIT. Default false. */
  acceptLicense?: boolean;
  /** Download lazily when the model is missing and not offline. Default true. */
  autoDownload?: boolean;
  /** Default: env GGML_NODE_CACHE_DIR, else the OS cache dir + /ggml-node. */
  cacheDir?: string;
  /** Default: min(model.contextLength, 4096). */
  contextSize?: number;
  /** "auto" uses Metal/CUDA/Vulkan when available. */
  gpu?: "auto" | false;
  /** Default "none". */
  isolation?: "none" | "process";
  /**
   * The model's kind. Default: read from the GGUF metadata (a model with a `pooling_type` is an
   * embedding model). Set it when the metadata is missing or wrong.
   */
  kind?: ModelKind;
  /** Parallel sequences. Default 1. */
  maxConcurrency?: number;
  /** Pending requests beyond concurrency. Overflow throws QUEUE_FULL. Default 64. */
  maxQueue?: number;
  /** A registry model id, or `{ path }` for a custom GGUF file. */
  model: ModelSource;
  /** Or env GGML_NODE_OFFLINE=1. Default false. */
  offline?: boolean;
  onEvent?: (event: GgmlNodeEvent) => void;
  /** Number of threads, or "auto". */
  threads?: number | "auto";
}

export interface GgmlNode {
  countTokens: (text: string) => Promise<number>;
  /** Embedding vectors for one or more texts. Requires an `embedding` model. */
  embed: (options: EmbedOptions) => Promise<EmbedResult>;
  /** Requires a `generation` model. */
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
