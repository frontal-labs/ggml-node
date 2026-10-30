import type { FinishReason, GenerateOptions, Message, Usage } from "../core/types.js";

/**
 * The inference backend. The core scheduler and public API only talk to this interface, so a
 * browser or edge backend can be added later without touching `core/`.
 */
export interface BackendLoadOptions {
  path: string;
  contextSize: number;
  sequences: number;
  threads?: number | undefined;
  gpu: "auto" | false;
}

export interface BackendRequest {
  messages: Message[];
  maxTokens: number;
  temperature: number;
  topP?: number | undefined;
  topK?: number | undefined;
  seed?: number | undefined;
  stop?: string[] | undefined;
  signal?: AbortSignal | undefined;
}

export interface BackendResult {
  text: string;
  finishReason: FinishReason;
  usage: Usage;
  /** Time from the start of generation to the first generated token, in ms. */
  firstTokenMs: number;
}

/** What the backend knows about a loaded model. The core adds the registry id and license. */
export interface BackendLoadResult {
  path: string;
  sizeBytes: number;
  contextSize: number;
  /** Context length the model was trained with, from GGUF metadata. */
  trainContextSize: number;
  gpu: string | false;
}

export interface Backend {
  load(options: BackendLoadOptions): Promise<BackendLoadResult>;
  /** Token count for a plain string, without any chat template. */
  countTokens(text: string): Promise<number>;
  /** Exact prompt token count for a message list, including the model's chat template. */
  countPromptTokens(messages: Message[]): Promise<number>;
  /**
   * Generates on the given sequence index. `onDelta` receives text as it is produced.
   * Resolves with `finishReason: "abort"` when the signal fires during generation.
   */
  generate(
    sequence: number,
    request: BackendRequest,
    onDelta: (text: string) => void,
  ): Promise<BackendResult>;
  /** Resets a sequence so the next request starts from an empty context. */
  resetSequence(sequence: number): Promise<void>;
  unload(): Promise<void>;
}

export type BackendFactory = () => Backend;

export type { GenerateOptions };
