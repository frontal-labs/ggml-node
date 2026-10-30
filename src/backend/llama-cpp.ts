import { stat } from "node:fs/promises";
import type { ChatHistoryItem } from "node-llama-cpp";
import { InboardError } from "../core/errors.js";
import type { Message } from "../core/types.js";
import type {
  Backend,
  BackendLoadOptions,
  BackendLoadResult,
  BackendRequest,
  BackendResult,
} from "./types.js";

/**
 * `node-llama-cpp` backend. The package is imported on first use, so importing `inboard` alone
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

interface Loaded {
  lib: NodeLlama;
  llama: Llama;
  model: LlamaModel;
  context: LlamaContext;
  sequences: LlamaContextSequence[];
  wrapper: ChatWrapper;
}

export function createLlamaCppBackend(): Backend {
  let loaded: Loaded | undefined;

  function state(): Loaded {
    if (!loaded) {
      throw new InboardError("INVALID_OPTIONS", "The backend is not loaded", {
        hint: "Call ready() first.",
      });
    }
    return loaded;
  }

  function sequence(index: number): LlamaContextSequence {
    const seq = state().sequences[index];
    if (!seq)
      throw new InboardError("INVALID_OPTIONS", `No sequence ${index}`, {
        hint: "Check maxConcurrency.",
      });
    return seq;
  }

  async function countPrompt(messages: Message[]): Promise<number> {
    const { wrapper, model } = state();
    const { contextText } = wrapper.generateContextState({ chatHistory: toHistory(messages) });
    return contextText.tokenize(model.tokenizer).length;
  }

  return {
    async load(options: BackendLoadOptions): Promise<BackendLoadResult> {
      const lib = await import("node-llama-cpp");
      let llama: Llama;
      try {
        llama = await lib.getLlama({
          gpu: options.gpu === false ? false : "auto",
          logLevel: lib.LlamaLogLevel.error,
        });
      } catch (err) {
        throw new InboardError(
          "UNSUPPORTED_PLATFORM",
          "node-llama-cpp could not start a backend on this machine",
          {
            hint: "Run: npx inboard doctor. Check that the prebuilt binary matches your OS and CPU architecture.",
            cause: err,
          },
        );
      }

      const model = await llama.loadModel({ modelPath: options.path });
      const context = await model.createContext({
        contextSize: options.contextSize,
        sequences: options.sequences,
        ...(options.threads !== undefined ? { threads: options.threads } : {}),
      });
      const sequences = Array.from({ length: options.sequences }, () => context.getSequence());

      // A probe chat reads the chat wrapper that `"auto"` resolves to from the GGUF metadata.
      // The wrapper is stateless, so the probe is disposed without touching its sequence.
      const probe = new lib.LlamaChat({
        contextSequence: sequences[0] as LlamaContextSequence,
        chatWrapper: "auto",
      });
      const wrapper = probe.chatWrapper;
      probe.dispose();

      loaded = { lib, llama, model, context, sequences, wrapper };
      const fileSize = (await stat(options.path)).size;
      return {
        path: options.path,
        sizeBytes: fileSize,
        contextSize: context.contextSize,
        trainContextSize: model.trainContextSize,
        gpu: llama.gpu,
      };
    },

    async countTokens(text: string): Promise<number> {
      return state().model.tokenize(text).length;
    },

    countPromptTokens: countPrompt,

    async generate(
      index: number,
      request: BackendRequest,
      onDelta: (text: string) => void,
    ): Promise<BackendResult> {
      const { lib, wrapper } = state();
      const chat = new lib.LlamaChat({ contextSequence: sequence(index), chatWrapper: wrapper });
      const started = performance.now();
      let firstTokenAt: number | undefined;
      let outputTokens = 0;

      try {
        const response = await chat.generateResponse(toHistory(request.messages), {
          maxTokens: request.maxTokens,
          temperature: request.temperature,
          ...(request.topP !== undefined ? { topP: request.topP } : {}),
          ...(request.topK !== undefined ? { topK: request.topK } : {}),
          ...(request.seed !== undefined ? { seed: request.seed } : {}),
          ...(request.stop?.length ? { customStopTriggers: request.stop } : {}),
          ...(request.signal ? { signal: request.signal } : {}),
          stopOnAbortSignal: true,
          onTextChunk: (text) => {
            firstTokenAt ??= performance.now();
            onDelta(text);
          },
          onToken: (tokens) => {
            outputTokens += tokens.length;
          },
        });

        const stopReason = response.metadata.stopReason;
        const finishReason =
          stopReason === "abort" ? "abort" : stopReason === "maxTokens" ? "length" : "stop";
        const inputTokens = await countPrompt(request.messages);
        return {
          text: response.response,
          finishReason,
          usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
          firstTokenMs: (firstTokenAt ?? performance.now()) - started,
        };
      } finally {
        chat.dispose();
      }
    },

    async resetSequence(index: number): Promise<void> {
      await sequence(index).clearHistory();
    },

    async unload(): Promise<void> {
      const current = loaded;
      loaded = undefined;
      if (!current) return;
      await current.context.dispose();
      await current.model.dispose();
      await current.llama.dispose();
    },
  };
}

function toHistory(messages: Message[]): ChatHistoryItem[] {
  return messages.map((m): ChatHistoryItem => {
    if (m.role === "system") return { type: "system", text: m.content };
    if (m.role === "user") return { type: "user", text: m.content };
    return { type: "model", response: [m.content] };
  });
}
