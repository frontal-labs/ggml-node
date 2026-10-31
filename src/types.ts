import type { FinishReason, JsonSchemaObject, Message, ModelKind, Usage } from "@/core/types.js";

/**
 * The inference backend. The core scheduler and public API only talk to this interface, so a
 * browser or edge backend can be added later without touching `core/`.
 */
export interface BackendLoadOptions {
  contextSize: number;
  gpu: "auto" | false;
  /** `embedding` loads an embedding context. It has no generation sequences. */
  kind: ModelKind;
  path: string;
  sequences: number;
  threads?: number | undefined;
}

/**
 * Handle for a grammar that constrains generation to one JSON Schema. The backend keeps the
 * native grammar under `key`, so the handle can cross a process boundary.
 */
export interface JsonGrammar {
  readonly key: string;
}

/** Result of checking generated text against the grammar's schema. */
export type ParsedOutput = { ok: true; value: unknown } | { ok: false; message: string };

export interface BackendRequest {
  /** When set, generation can only produce text that matches this grammar. */
  grammar?: JsonGrammar | undefined;
  maxTokens: number;
  messages: Message[];
  seed?: number | undefined;
  signal?: AbortSignal | undefined;
  stop?: string[] | undefined;
  temperature: number;
  topK?: number | undefined;
  topP?: number | undefined;
}

export interface BackendResult {
  finishReason: FinishReason;
  /** Time from the start of generation to the first generated token, in ms. */
  firstTokenMs: number;
  /** Set when the request used a grammar. The backend decodes and validates the text itself. */
  parsed?: ParsedOutput | undefined;
  text: string;
  usage: Usage;
}

/** Result of embedding a batch. Vectors are in input order. */
export interface BackendEmbedResult {
  inputTokens: number;
  vectors: number[][];
}

/** What the backend knows about a loaded model. The core adds the registry id and license. */
export interface BackendLoadResult {
  contextSize: number;
  /** Length of each embedding vector. Set only when the model was loaded as `embedding`. */
  dimensions?: number | undefined;
  gpu: string | false;
  path: string;
  sizeBytes: number;
  /** Context length the model was trained with, from GGUF metadata. */
  trainContextSize: number;
}

export interface Backend {
  /** Builds (or reuses) a grammar for a JSON Schema. Schemas must already pass the supported-subset check. */
  buildJsonGrammar: (schema: JsonSchemaObject) => Promise<JsonGrammar>;
  /** Exact prompt token count for a message list, including the model's chat template. */
  countPromptTokens: (messages: Message[]) => Promise<number>;
  /** Token count for a plain string, without any chat template. */
  countTokens: (text: string) => Promise<number>;
  /**
   * Embeds each input on its own. Inputs that do not fit the context reject with `CONTEXT_OVERFLOW`.
   * Checks `signal` between inputs and rejects with `ABORTED`.
   */
  embed: (inputs: string[], signal?: AbortSignal) => Promise<BackendEmbedResult>;
  /**
   * Generates on the given sequence index. `onDelta` receives text as it is produced.
   * Resolves with `finishReason: "abort"` when the signal fires during generation.
   */
  generate: (
    sequence: number,
    request: BackendRequest,
    onDelta: (text: string) => void,
  ) => Promise<BackendResult>;
  load: (options: BackendLoadOptions) => Promise<BackendLoadResult>;
  /** Resets a sequence so the next request starts from an empty context. */
  resetSequence: (sequence: number) => Promise<void>;
  unload: () => Promise<void>;
}

export type BackendFactory = () => Backend;
