import type { LanguageModelV4 } from "@ai-sdk/provider";
import { languageModelFor } from "@/ai/model.js";
import { createNodeSlmWithDeps } from "@/core/node-slm.js";
import type { NodeSlm } from "@/core/types.js";
import { createMockBackend, type MockBackendOptions } from "@/testing/mock-backend.js";

/**
 * `node-slm/testing`: an NodeSlm that answers without a model. It loads no native code, needs no
 * file, and returns the same shapes as the real thing. Use it in unit tests of code that calls NodeSlm.
 */

export type { MockBackendOptions, MockResponder } from "@/testing/mock-backend.js";

export interface MockNodeSlmOptions extends MockBackendOptions {
  /** The model id reported in results. Default "custom". */
  model?: string;
}

export function createMockNodeSlm(options: MockNodeSlmOptions = {}): NodeSlm {
  const { model: _model, ...backend } = options;
  return createNodeSlmWithDeps(
    { model: { path: "mock://node-slm" } },
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

/** An AI SDK language model that answers from a mock NodeSlm. Works with `generateText` and friends. */
export function mockModel(options: MockBackendOptions = {}): LanguageModelV4 {
  return languageModelFor("mock", createMockNodeSlm(options));
}
