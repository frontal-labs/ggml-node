import type {
  Backend,
  BackendLoadOptions,
  BackendRequest,
  BackendResult,
  ParsedOutput,
} from "@/backend/types.js";
import type { JsonSchemaObject, Message } from "@/core/types.js";

export interface FakeBackendOptions {
  /** Produces the reply for a request. Default echoes the last user message. */
  respond?: (messages: Message[]) => string;
  /** Delay before each streamed word, in ms. Lets tests abort mid-stream. */
  delayMs?: number;
  /** Throw this from generate() instead of answering. */
  failWith?: unknown;
  /** Called when a sequence starts generating. Used to observe concurrency. */
  onStart?: (sequence: number) => void;
  onEnd?: (sequence: number) => void;
}

export interface FakeBackend extends Backend {
  loads: number;
  unloads: number;
  grammarBuilds: number;
  resets: number[];
  generations: number[];
  maxActive: number;
  active: number;
}

function fakeParse(text: string): ParsedOutput {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "invalid JSON" };
  }
}

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** A deterministic backend. Counts tokens as whitespace-separated words. */
export function createFakeBackend(options: FakeBackendOptions = {}): FakeBackend {
  const respond =
    options.respond ??
    ((messages: Message[]) => {
      const last = [...messages].reverse().find((m) => m.role === "user");
      return `echo: ${last?.content ?? ""}`;
    });

  const backend: FakeBackend = {
    loads: 0,
    unloads: 0,
    grammarBuilds: 0,
    resets: [],
    generations: [],
    maxActive: 0,
    active: 0,
    async load(load: BackendLoadOptions) {
      backend.loads += 1;
      return {
        path: load.path,
        sizeBytes: 1000,
        contextSize: load.contextSize,
        trainContextSize: 4096,
        gpu: false,
      };
    },
    async countTokens(text: string) {
      return wordsOf(text).length;
    },
    async countPromptTokens(messages: Message[]) {
      return messages.reduce((n, m) => n + wordsOf(m.content).length + 2, 0);
    },
    async generate(
      sequence: number,
      request: BackendRequest,
      onDelta: (text: string) => void,
    ): Promise<BackendResult> {
      if (options.failWith !== undefined) throw options.failWith;
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
          if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
          if (request.signal?.aborted) {
            finishReason = "abort";
            break;
          }
          const piece = (text ? " " : "") + word;
          firstTokenAt ??= performance.now();
          text += piece;
          onDelta(piece);
        }
        if (finishReason === "stop" && wordsOf(text).length >= request.maxTokens)
          finishReason = "length";
      } finally {
        backend.active -= 1;
        options.onEnd?.(sequence);
      }
      const inputTokens = await backend.countPromptTokens(request.messages);
      const outputTokens = wordsOf(text).length;
      return {
        text,
        finishReason,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        firstTokenMs: (firstTokenAt ?? performance.now()) - started,
        // The fake does not enforce the schema. It only decodes JSON, so tests can check the wiring.
        parsed: request.grammar ? fakeParse(text) : undefined,
      };
    },
    async buildJsonGrammar(schema: JsonSchemaObject) {
      backend.grammarBuilds += 1;
      return { key: JSON.stringify(schema) };
    },
    async resetSequence(sequence: number) {
      backend.resets.push(sequence);
    },
    async unload() {
      backend.unloads += 1;
    },
  };
  return backend;
}
