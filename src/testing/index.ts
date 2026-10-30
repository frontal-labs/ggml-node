import type { LanguageModelV4 } from "@ai-sdk/provider";
import { languageModelFor } from "@/ai/model.js";
import { createTinyLLMWithDeps } from "@/core/tiny-llm.js";
import type { TinyLLM } from "@/core/types.js";
import { createMockBackend, type MockBackendOptions } from "@/testing/mock-backend.js";

/**
 * `tiny-llm/testing`: an TinyLLM that answers without a model. It loads no native code, needs no
 * file, and returns the same shapes as the real thing. Use it in unit tests of code that calls TinyLLM.
 */

export type { MockBackendOptions, MockResponder } from "@/testing/mock-backend.js";

export interface MockTinyLLMOptions extends MockBackendOptions {
  /** The model id reported in results. Default "custom". */
  model?: string;
}

export function createMockTinyLLM(options: MockTinyLLMOptions = {}): TinyLLM {
  const { model: _model, ...backend } = options;
  return createTinyLLMWithDeps(
    { model: { path: "mock://tiny-llm" } },
    {
      createBackend: () => createMockBackend(backend),
      memory: {
        availableSystemBytes: async () => Number.POSITIVE_INFINITY,
        cgroupCurrentBytes: async () => undefined,
        cgroupLimitBytes: async () => undefined,
      },
      pathExists: async () => true,
      readMeta: async () => ({
        shape: { blockCount: 1, headCountKv: 1, keyLength: 8, valueLength: 8 },
        sizeBytes: 0,
        trainContextSize: 4096,
      }),
    },
  );
}

/** An AI SDK language model that answers from a mock TinyLLM. Works with `generateText` and friends. */
export function mockModel(options: MockBackendOptions = {}): LanguageModelV4 {
  return languageModelFor("mock", createMockTinyLLM(options));
}
