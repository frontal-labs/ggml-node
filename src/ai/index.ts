import type { EmbeddingModelV4, LanguageModelV4 } from "@ai-sdk/provider";
import { embeddingModelFor, languageModelFor } from "@/ai/model.js";
import { createGgmlNode } from "@/core/ggml-node.js";
import type { GgmlNode, GgmlNodeOptions, ModelId } from "@/core/types.js";

export type { ModelId } from "@/registry/models.js";

/**
 * AI SDK provider for GgmlNode. Works with `generateText`, `streamText` and `generateObject` from
 * `ai` (spec v4, `@ai-sdk/provider` 4.x).
 *
 * Settings are the same as `createGgmlNode`, minus `model`, which comes from the call. Two calls
 * with the same model and settings share one loaded instance. The `onEvent` callback is not part of
 * that key, so pass the same settings object shape to share an instance.
 */
export type GgmlNodeProviderSettings = Omit<GgmlNodeOptions, "model">;

export interface GgmlNodeProvider {
  /** An embedding model for `embedMany` and `embed`. The model must be an embedding model. */
  embeddingModel: (modelId: ModelId) => EmbeddingModelV4;
  languageModel: (modelId: ModelId) => LanguageModelV4;
  (modelId: ModelId): LanguageModelV4;
}

/** One provider per settings key, shared by `ggmlNode()`. */
const sharedProviders = new Map<string, GgmlNodeProvider>();

/** Returns a language model for a registry model. Shares one provider per settings value. */
export function ggmlNode(
  modelId: ModelId,
  settings: GgmlNodeProviderSettings = {},
): LanguageModelV4 {
  return sharedProvider(settings).languageModel(modelId);
}

/** Returns an embedding model for a registry embedding model. Shares instances with `ggmlNode`. */
export function ggmlEmbedding(
  modelId: ModelId,
  settings: GgmlNodeProviderSettings = {},
): EmbeddingModelV4 {
  return sharedProvider(settings).embeddingModel(modelId);
}

function sharedProvider(settings: GgmlNodeProviderSettings): GgmlNodeProvider {
  const key = settingsKey(settings);
  let provider = sharedProviders.get(key);
  if (!provider) {
    provider = createGgmlNodeProvider(settings);
    sharedProviders.set(key, provider);
  }
  return provider;
}

export function createGgmlNodeProvider(settings: GgmlNodeProviderSettings = {}): GgmlNodeProvider {
  const instances = new Map<ModelId, GgmlNode>();

  const instanceFor = (modelId: ModelId): GgmlNode => {
    let instance = instances.get(modelId);
    if (!instance) {
      instance = createGgmlNode({ ...settings, model: modelId });
      instances.set(modelId, instance);
    }
    return instance;
  };

  const languageModel = (modelId: ModelId): LanguageModelV4 =>
    languageModelFor(modelId, instanceFor(modelId));
  const embeddingModel = (modelId: ModelId): EmbeddingModelV4 =>
    embeddingModelFor(modelId, instanceFor(modelId));

  const provider = ((modelId: ModelId) => languageModel(modelId)) as GgmlNodeProvider;
  provider.languageModel = languageModel;
  provider.embeddingModel = embeddingModel;
  return provider;
}

function settingsKey(settings: GgmlNodeProviderSettings): string {
  // Functions cannot be serialized, so they are left out of the key. See the note on GgmlNodeProviderSettings.
  return JSON.stringify(settings, (_key, value: unknown) =>
    typeof value === "function" ? undefined : value,
  );
}
