import type { LanguageModelV4 } from "@ai-sdk/provider";
import { languageModelFor } from "@/ai/model.js";
import { createLocalLLMWithDeps } from "@/core/local-llm.js";
import type { LocalLLM } from "@/core/types.js";
import { createMockBackend, type MockBackendOptions } from "@/testing/mock-backend.js";

/**
 * `local-llm/testing`: an LocalLLM that answers without a model. It loads no native code, needs no
 * file, and returns the same shapes as the real thing. Use it in unit tests of code that calls LocalLLM.
 */

export type { MockBackendOptions, MockResponder } from "@/testing/mock-backend.js";

export interface MockLocalLLMOptions extends MockBackendOptions {
  /** The model id reported in results. Default "custom". */
  model?: string;
}

export function createMockLocalLLM(options: MockLocalLLMOptions = {}): LocalLLM {
  const { model: _model, ...backend } = options;
  return createLocalLLMWithDeps(
    { model: { path: "mock://local-llm" } },
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

/** An AI SDK language model that answers from a mock LocalLLM. Works with `generateText` and friends. */
export function mockModel(options: MockBackendOptions = {}): LanguageModelV4 {
  return languageModelFor("mock", createMockLocalLLM(options));
}
