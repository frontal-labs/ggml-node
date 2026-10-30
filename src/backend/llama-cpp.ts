// biome-ignore-all lint/suspicious/useAwait: backend methods return promises for one uniform interface
// biome-ignore-all lint/style/useErrorCause: TinyLLMError takes its cause inside the options object (see src/core/errors.ts)
import { stat } from "node:fs/promises";
import type { ChatHistoryItem } from "node-llama-cpp";
import type {
  Backend,
  BackendLoadOptions,
  BackendLoadResult,
  BackendRequest,
  BackendResult,
  JsonGrammar,
  ParsedOutput,
} from "@/backend/types.js";
import { TinyLLMError } from "@/core/errors.js";
import type { FinishReason, JsonSchemaObject, Message } from "@/core/types.js";

/**
 * `node-llama-cpp` backend. The package is imported on first use, so importing `tiny-llm` alone
 * never loads the native binary.
 *
 * The chat template comes from the GGUF metadata (`chatWrapper: "auto"`). It is never hand-written.
 * Each request builds a stateless chat over a pooled sequence, and the sequence is cleared first.
 */

type NodeLlama = typeof import("node-llama-cpp");
type Llama = Awaited<ReturnType<NodeLlama["getLlama"]>>;
type LlamaModel = Awaited<ReturnType<Llama["loadModel"]>>;
type LlamaContext = Awaited<ReturnType<LlamaModel["createContext"]>>;
type LlamaContextSequence = ReturnType<LlamaContext["getSequence"]>;
type ChatWrapper = InstanceType<NodeLlama["ChatWrapper"]>;
type NativeGrammar = Awaited<ReturnType<Llama["createGrammarForJsonSchema"]>>;

interface Loaded {
  context: LlamaContext;
  lib: NodeLlama;
  llama: Llama;
  model: LlamaModel;
  sequences: LlamaContextSequence[];
  wrapper: ChatWrapper;
}

const MAX_CACHED_GRAMMARS = 16;

export function createLlamaCppBackend(): Backend {
  let loaded: Loaded | undefined;
  /** Native grammars by key. Cleared on unload, because each one belongs to the loaded llama. */
  const nativeGrammars = new Map<string, NativeGrammar>();

  function state(): Loaded {
    if (!loaded) {
      throw new TinyLLMError("INVALID_OPTIONS", "The backend is not loaded", {
        hint: "Call ready() first.",
      });
    }
    return loaded;
  }

  function sequence(index: number): LlamaContextSequence {
    const seq = state().sequences[index];
    if (!seq) {
      throw new TinyLLMError("INVALID_OPTIONS", `No sequence ${index}`, {
        hint: "Check maxConcurrency.",
      });
    }
    return seq;
  }

  async function countPrompt(messages: Message[]): Promise<number> {
    const { wrapper, model } = state();
    const { contextText } = wrapper.generateContextState({ chatHistory: toHistory(messages) });
    return contextText.tokenize(model.tokenizer).length;
  }

  function grammarOf(key: string): NativeGrammar {
    const native = nativeGrammars.get(key);
    if (!native) {
      throw new TinyLLMError("INVALID_OPTIONS", "The grammar is not loaded in this backend", {
        hint: "Build the grammar with buildJsonGrammar() after the model is loaded.",
      });
    }
    return native;
  }

  return {
    async buildJsonGrammar(schema: JsonSchemaObject): Promise<JsonGrammar> {
      const key = JSON.stringify(schema);
      if (nativeGrammars.has(key)) {
        return { key };
      }

      const { llama } = state();
      let native: Awaited<ReturnType<Llama["createGrammarForJsonSchema"]>>;
      try {
        native = await llama.createGrammarForJsonSchema(
          schema as Parameters<Llama["createGrammarForJsonSchema"]>[0],
        );
      } catch (err) {
        throw new TinyLLMError(
          "INVALID_OPTIONS",
          "The JSON Schema could not be compiled into a grammar",
          {
            cause: err,
            hint: "Check the schema against the supported subset in docs/structured-output.md.",
          },
        );
      }

      if (nativeGrammars.size >= MAX_CACHED_GRAMMARS) {
        const oldest = nativeGrammars.keys().next().value;
        if (oldest !== undefined) {
          nativeGrammars.delete(oldest);
        }
      }
      nativeGrammars.set(key, native);
      return { key };
    },

    countPromptTokens: countPrompt,

    async countTokens(text: string): Promise<number> {
      return state().model.tokenize(text).length;
    },

    async generate(
      index: number,
      request: BackendRequest,
      onDelta: (text: string) => void,
    ): Promise<BackendResult> {
      const { lib, wrapper } = state();
      const chat = new lib.LlamaChat({ chatWrapper: wrapper, contextSequence: sequence(index) });
      const started = performance.now();
      let firstTokenAt: number | undefined;
      let outputTokens = 0;

      try {
        const response = await chat.generateResponse(toHistory(request.messages), {
          maxTokens: request.maxTokens,
          temperature: request.temperature,
          ...(request.topP === undefined ? {} : { topP: request.topP }),
          ...(request.topK === undefined ? {} : { topK: request.topK }),
          ...(request.seed === undefined ? {} : { seed: request.seed }),
          ...(request.stop?.length ? { customStopTriggers: request.stop } : {}),
          ...(request.signal ? { signal: request.signal } : {}),
          ...(request.grammar ? { grammar: grammarOf(request.grammar.key) } : {}),
          onTextChunk: (text) => {
            firstTokenAt ??= performance.now();
            onDelta(text);
          },
          onToken: (tokens) => {
            outputTokens += tokens.length;
          },
          stopOnAbortSignal: true,
        });

        const finishReason = finishReasonOf(response.metadata.stopReason);
        const inputTokens = await countPrompt(request.messages);
        return {
          finishReason,
          firstTokenMs: (firstTokenAt ?? performance.now()) - started,
          parsed: request.grammar
            ? parseWith(grammarOf(request.grammar.key), response.response)
            : undefined,
          text: response.response,
          usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        };
      } finally {
        chat.dispose();
      }
    },
    async load(options: BackendLoadOptions): Promise<BackendLoadResult> {
      const lib = await import("node-llama-cpp");
      let llama: Llama;
      try {
        llama = await lib.getLlama({
          gpu: options.gpu === false ? false : "auto",
          logLevel: lib.LlamaLogLevel.error,
        });
      } catch (err) {
        throw new TinyLLMError(
          "UNSUPPORTED_PLATFORM",
          "node-llama-cpp could not start a backend on this machine",
          {
            cause: err,
            hint: "Run: npx tiny-llm doctor. Check that the prebuilt binary matches your OS and CPU architecture.",
          },
        );
      }

      const model = await llama.loadModel({ modelPath: options.path });
      const context = await model.createContext({
        contextSize: options.contextSize,
        sequences: options.sequences,
        ...(options.threads === undefined ? {} : { threads: options.threads }),
      });
      const sequences = Array.from({ length: options.sequences }, () => context.getSequence());

      // A probe chat reads the chat wrapper that `"auto"` resolves to from the GGUF metadata.
      // The wrapper is stateless, so the probe is disposed without touching its sequence.
      const probe = new lib.LlamaChat({
        chatWrapper: "auto",
        contextSequence: sequences[0] as LlamaContextSequence,
      });
      const wrapper = probe.chatWrapper;
      probe.dispose();

      loaded = { context, lib, llama, model, sequences, wrapper };
      const fileSize = (await stat(options.path)).size;
      return {
        contextSize: context.contextSize,
        gpu: llama.gpu,
        path: options.path,
        sizeBytes: fileSize,
        trainContextSize: model.trainContextSize,
      };
    },

    async resetSequence(index: number): Promise<void> {
      await sequence(index).clearHistory();
    },

    async unload(): Promise<void> {
      const current = loaded;
      loaded = undefined;
      nativeGrammars.clear();
      if (!current) {
        return;
      }
      await current.context.dispose();
      await current.model.dispose();
      await current.llama.dispose();
    },
  };
}

/** Decodes grammar output and checks it against the schema. Failures are reported, not thrown. */
function finishReasonOf(stopReason: string): FinishReason {
  if (stopReason === "abort") {
    return "abort";
  }
  return stopReason === "maxTokens" ? "length" : "stop";
}

function parseWith(grammar: NativeGrammar, text: string): ParsedOutput {
  try {
    return { ok: true, value: grammar.parse(text) };
  } catch (err) {
    return { message: err instanceof Error ? err.message : "invalid JSON", ok: false };
  }
}

function toHistory(messages: Message[]): ChatHistoryItem[] {
  return messages.map((m): ChatHistoryItem => {
    if (m.role === "system") {
      return { text: m.content, type: "system" };
    }
    if (m.role === "user") {
      return { text: m.content, type: "user" };
    }
    return { response: [m.content], type: "model" };
  });
}
