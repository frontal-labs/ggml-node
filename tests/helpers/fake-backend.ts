// biome-ignore-all lint/suspicious/useAwait: fake backend methods return promises for one uniform interface
// biome-ignore-all lint/performance/noAwaitInLoops: the fake streams words one at a time, in order
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: the fake mirrors the real generate loop
import type {
  Backend,
  BackendLoadOptions,
  BackendRequest,
  BackendResult,
  ParsedOutput,
} from "@/backend/types.js";
import type { JsonSchemaObject, Message } from "@/core/types.js";

export interface FakeBackendOptions {
  /** Delay before each streamed word, in ms. Lets tests abort mid-stream. */
  delayMs?: number;
  /** Throw this from generate() instead of answering. */
  failWith?: unknown;
  onEnd?: (sequence: number) => void;
  /** Called when a sequence starts generating. Used to observe concurrency. */
  onStart?: (sequence: number) => void;
  /** Produces the reply for a request. Default echoes the last user message. */
  respond?: (messages: Message[]) => string;
}

export interface FakeBackend extends Backend {
  active: number;
  generations: number[];
  grammarBuilds: number;
  loads: number;
  maxActive: number;
  resets: number[];
  unloads: number;
}

function fakeParse(text: string): ParsedOutput {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { message: err instanceof Error ? err.message : "invalid JSON", ok: false };
  }
}

const WHITESPACE = /\s+/u;
const wordsOf = (text: string) => text.split(WHITESPACE).filter(Boolean);

/** A deterministic backend. Counts tokens as whitespace-separated words. */
export function createFakeBackend(options: FakeBackendOptions = {}): FakeBackend {
  const respond =
    options.respond ??
    ((messages: Message[]) => {
      const last = [...messages].reverse().find((m) => m.role === "user");
      return `echo: ${last?.content ?? ""}`;
    });

  const backend: FakeBackend = {
    active: 0,
    async buildJsonGrammar(schema: JsonSchemaObject) {
      backend.grammarBuilds += 1;
      return { key: JSON.stringify(schema) };
    },
    async countPromptTokens(messages: Message[]) {
      return messages.reduce((n, m) => n + wordsOf(m.content).length + 2, 0);
    },
    async countTokens(text: string) {
      return wordsOf(text).length;
    },
    async generate(
      sequence: number,
      request: BackendRequest,
      onDelta: (text: string) => void,
    ): Promise<BackendResult> {
      if (options.failWith !== undefined) {
        throw options.failWith;
      }
      backend.generations.push(sequence);
      backend.active += 1;
      backend.maxActive = Math.max(backend.maxActive, backend.active);
      options.onStart?.(sequence);
      const started = performance.now();
      let firstTokenAt: number | undefined;
      let text = "";
      let finishReason: BackendResult["finishReason"] = "stop";
      try {
        const words = wordsOf(respond(request.messages));
        for (const word of words) {
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
          const piece = (text ? " " : "") + word;
          firstTokenAt ??= performance.now();
          text += piece;
          onDelta(piece);
        }
        if (finishReason === "stop" && wordsOf(text).length >= request.maxTokens) {
          finishReason = "length";
        }
      } finally {
        backend.active -= 1;
        options.onEnd?.(sequence);
      }
      const inputTokens = await backend.countPromptTokens(request.messages);
      const outputTokens = wordsOf(text).length;
      return {
        finishReason,
        firstTokenMs: (firstTokenAt ?? performance.now()) - started,
        // The fake does not enforce the schema. It only decodes JSON, so tests can check the wiring.
        parsed: request.grammar ? fakeParse(text) : undefined,
        text,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      };
    },
    generations: [],
    grammarBuilds: 0,
    async load(load: BackendLoadOptions) {
      backend.loads += 1;
      return {
        contextSize: load.contextSize,
        gpu: false,
        path: load.path,
        sizeBytes: 1000,
        trainContextSize: 4096,
      };
    },
    loads: 0,
    maxActive: 0,
    async resetSequence(sequence: number) {
      backend.resets.push(sequence);
    },
    resets: [],
    async unload() {
      backend.unloads += 1;
    },
    unloads: 0,
  };
  return backend;
}
