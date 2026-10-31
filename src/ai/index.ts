import type { LanguageModelV4 } from "@ai-sdk/provider";
import { languageModelFor } from "@/ai/model.js";
import { createNodeSlm } from "@/core/node-slm.js";
import type { ModelId, NodeSlm, NodeSlmOptions } from "@/core/types.js";

export type { ModelId } from "@/registry/models.js";

/**
 * AI SDK provider for NodeSlm. Works with `generateText`, `streamText` and `generateObject` from
 * `ai` (spec v4, `@ai-sdk/provider` 4.x).
 *
 * Settings are the same as `createNodeSlm`, minus `model`, which comes from the call. Two calls
 * with the same model and settings share one loaded instance. The `onEvent` callback is not part of
 * that key, so pass the same settings object shape to share an instance.
 */
export type NodeSlmProviderSettings = Omit<NodeSlmOptions, "model">;

export interface NodeSlmProvider {
  languageModel: (modelId: ModelId) => LanguageModelV4;
  (modelId: ModelId): LanguageModelV4;
}

/** One provider per settings key, shared by `nodeSlm()`. */
const sharedProviders = new Map<string, NodeSlmProvider>();

/** Returns a language model for a registry model. Shares one provider per settings value. */
export function nodeSlm(modelId: ModelId, settings: NodeSlmProviderSettings = {}): LanguageModelV4 {
  const key = settingsKey(settings);
  let provider = sharedProviders.get(key);
  if (!provider) {
    provider = createNodeSlmProvider(settings);
    sharedProviders.set(key, provider);
  }
  return provider.languageModel(modelId);
}

export function createNodeSlmProvider(settings: NodeSlmProviderSettings = {}): NodeSlmProvider {
  const instances = new Map<ModelId, NodeSlm>();

  const instanceFor = (modelId: ModelId): NodeSlm => {
    let instance = instances.get(modelId);
    if (!instance) {
      instance = createNodeSlm({ ...settings, model: modelId });
      instances.set(modelId, instance);
    }
    return instance;
  };

  const languageModel = (modelId: ModelId): LanguageModelV4 =>
    languageModelFor(modelId, instanceFor(modelId));

  const provider = ((modelId: ModelId) => languageModel(modelId)) as NodeSlmProvider;
  provider.languageModel = languageModel;
  return provider;
}

function settingsKey(settings: NodeSlmProviderSettings): string {
  // Functions cannot be serialized, so they are left out of the key. See the note on NodeSlmProviderSettings.
  return JSON.stringify(settings, (_key, value: unknown) =>
    typeof value === "function" ? undefined : value,
  );
}
