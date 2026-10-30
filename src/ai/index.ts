import type { LanguageModelV4 } from "@ai-sdk/provider";
import { languageModelFor } from "@/ai/model.js";
import { createInboard } from "@/core/inboard.js";
import type { Inboard, InboardOptions, ModelId } from "@/core/types.js";

export type { ModelId } from "@/registry/models.js";

/**
 * AI SDK provider for Inboard. Works with `generateText`, `streamText` and `generateObject` from
 * `ai` (spec v4, `@ai-sdk/provider` 4.x).
 *
 * Settings are the same as `createInboard`, minus `model`, which comes from the call. Two calls
 * with the same model and settings share one loaded instance. The `onEvent` callback is not part of
 * that key, so pass the same settings object shape to share an instance.
 */
export type InboardProviderSettings = Omit<InboardOptions, "model">;

export interface InboardProvider {
  languageModel: (modelId: ModelId) => LanguageModelV4;
  (modelId: ModelId): LanguageModelV4;
}

/** One provider per settings key, shared by `inboard()`. */
const sharedProviders = new Map<string, InboardProvider>();

/** Returns a language model for a registry model. Shares one provider per settings value. */
export function inboard(modelId: ModelId, settings: InboardProviderSettings = {}): LanguageModelV4 {
  const key = settingsKey(settings);
  let provider = sharedProviders.get(key);
  if (!provider) {
    provider = createInboardProvider(settings);
    sharedProviders.set(key, provider);
  }
  return provider.languageModel(modelId);
}

export function createInboardProvider(settings: InboardProviderSettings = {}): InboardProvider {
  const instances = new Map<ModelId, Inboard>();

  const instanceFor = (modelId: ModelId): Inboard => {
    let instance = instances.get(modelId);
    if (!instance) {
      instance = createInboard({ ...settings, model: modelId });
      instances.set(modelId, instance);
    }
    return instance;
  };

  const languageModel = (modelId: ModelId): LanguageModelV4 =>
    languageModelFor(modelId, instanceFor(modelId));

  const provider = ((modelId: ModelId) => languageModel(modelId)) as InboardProvider;
  provider.languageModel = languageModel;
  return provider;
}

function settingsKey(settings: InboardProviderSettings): string {
  // Functions cannot be serialized, so they are left out of the key. See the note on InboardProviderSettings.
  return JSON.stringify(settings, (_key, value: unknown) =>
    typeof value === "function" ? undefined : value,
  );
}
