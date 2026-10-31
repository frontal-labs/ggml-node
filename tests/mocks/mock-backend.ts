// biome-ignore-all lint/suspicious/useAwait: Backend methods return promises for one uniform interface
// biome-ignore-all lint/performance/noAwaitInLoops: the mock streams chunks one at a time, in order
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: the mock mirrors the real generate loop

import type { FinishReason, JsonSchemaObject, Message } from "@/core/types.js";
import type {
  Backend,
  BackendEmbedResult,
  BackendLoadOptions,
  BackendLoadResult,
  BackendRequest,
  BackendResult,
  JsonGrammar,
  ParsedOutput,
} from "@/types.js";

/** What a mock reply can be: a fixed string, a list played in order, or a function of the request. */
export type MockResponder =
  | string
  | readonly string[]
  | ((request: { messages: readonly Message[] }) => string);

export interface MockBackendOptions {
  /** Delay before each emitted chunk, in ms. Lets tests abort mid-stream. */
  delayMs?: number;
  /** Length of each embedding vector when the model is loaded as `embedding`. Default 8. */
  dimensions?: number;
  respond?: MockResponder;
  /** Words emitted per streamed chunk. Default 1. */
  tokensPerChunk?: number;
}

const WHITESPACE = /\s+/u;
const words = (text: string): string[] => text.split(WHITESPACE).filter(Boolean);
const DEFAULT_DIMENSIONS = 8;

/** A fixed unit vector per text: the same text always gives the same vector, and different texts differ. */
function vectorFor(text: string, dimensions: number): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const [i, char] of [...text].entries()) {
    vector[i % dimensions] = (vector[i % dimensions] ?? 0) + char.charCodeAt(0);
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => value / norm);
}

/**
 * A deterministic backend with no native code. Token counts are whitespace-separated words.
 * Lists of replies cycle back to the start when they run out.
 */
export function createMockBackend(options: MockBackendOptions = {}): Backend {
  let loaded = false;
  let loadedKind: BackendLoadOptions["kind"] = "generation";
  let listCursor = 0;
  const { respond = (r: { messages: readonly Message[] }) => `echo: ${lastUser(r.messages)}` } =
    options;
  const chunkSize = Math.max(1, options.tokensPerChunk ?? 1);
  const dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;

  function nextReply(messages: readonly Message[]): string {
    if (typeof respond === "string") {
      return respond;
    }
    if (typeof respond === "function") {
      return respond({ messages });
    }
    const reply = respond[listCursor % respond.length] ?? "";
    listCursor += 1;
    return reply;
  }

  return {
    async buildJsonGrammar(schema: JsonSchemaObject): Promise<JsonGrammar> {
      return { key: JSON.stringify(schema) };
    },
    async countPromptTokens(messages: Message[]): Promise<number> {
      return messages.reduce((n, m) => n + words(m.content).length + 2, 0);
    },
    async countTokens(text: string): Promise<number> {
      return words(text).length;
    },
    async embed(inputs: string[]): Promise<BackendEmbedResult> {
      if (!loaded || loadedKind !== "embedding") {
        throw new Error("mock backend embed() needs an embedding model loaded");
      }
      return {
        inputTokens: inputs.reduce((n, text) => n + words(text).length, 0),
        vectors: inputs.map((text) => vectorFor(text, dimensions)),
      };
    },
    async generate(
      _sequence: number,
      request: BackendRequest,
      onDelta: (text: string) => void,
    ): Promise<BackendResult> {
      if (!loaded) {
        throw new Error("mock backend used before load()");
      }
      const reply = nextReply(request.messages);
      const parts = words(reply);
      const start = performance.now();
      let firstAt: number | undefined;
      let emitted = "";
      let finishReason: FinishReason = "stop";

      for (let i = 0; i < parts.length; i += chunkSize) {
        if (request.signal?.aborted) {
          finishReason = "abort";
          break;
        }
        if (options.delayMs) {
          await new Promise((r) => setTimeout(r, options.delayMs));
        }
        if (request.signal?.aborted) {
          finishReason = "abort";
          break;
        }
        const piece = `${emitted ? " " : ""}${parts.slice(i, i + chunkSize).join(" ")}`;
        firstAt ??= performance.now();
        emitted += piece;
        onDelta(piece);
      }
      if (
        finishReason === "stop" &&
        request.maxTokens &&
        words(emitted).length >= request.maxTokens
      ) {
        finishReason = "length";
      }

      const inputTokens = countWords(request.messages);
      const outputTokens = words(emitted).length;
      const parsed: ParsedOutput | undefined = request.grammar ? parseJson(emitted) : undefined;
      return {
        finishReason,
        firstTokenMs: (firstAt ?? performance.now()) - start,
        parsed,
        text: emitted,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      };
    },
    async load(load: BackendLoadOptions): Promise<BackendLoadResult> {
      loaded = true;
      loadedKind = load.kind;
      return {
        contextSize: load.contextSize,
        dimensions: load.kind === "embedding" ? dimensions : undefined,
        gpu: false,
        path: load.path,
        sizeBytes: 0,
        trainContextSize: 4096,
      };
    },
    resetSequence: () => Promise.resolve(),
    async unload(): Promise<void> {
      loaded = false;
    },
  };
}

function lastUser(messages: readonly Message[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === "user") {
      return m.content;
    }
  }
  return "";
}

function countWords(list: readonly Message[]): number {
  return list.reduce((n, m) => n + words(m.content).length + 2, 0);
}

function parseJson(text: string): ParsedOutput {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { message: err instanceof Error ? err.message : "invalid JSON", ok: false };
  }
}
