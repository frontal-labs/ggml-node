import type { LanguageModelV4 } from "@ai-sdk/provider";
import { languageModelFor } from "@/ai/model.js";
import { createTinyLLM } from "@/core/tiny-llm.js";
import type { ModelId, TinyLLM, TinyLLMOptions } from "@/core/types.js";

export type { ModelId } from "@/registry/models.js";

/**
 * AI SDK provider for TinyLLM. Works with `generateText`, `streamText` and `generateObject` from
 * `ai` (spec v4, `@ai-sdk/provider` 4.x).
 *
 * Settings are the same as `createTinyLLM`, minus `model`, which comes from the call. Two calls
 * with the same model and settings share one loaded instance. The `onEvent` callback is not part of
 * that key, so pass the same settings object shape to share an instance.
 */
export type TinyLLMProviderSettings = Omit<TinyLLMOptions, "model">;

export interface TinyLLMProvider {
  languageModel: (modelId: ModelId) => LanguageModelV4;
  (modelId: ModelId): LanguageModelV4;
}

/** One provider per settings key, shared by `tinyLLM()`. */
const sharedProviders = new Map<string, TinyLLMProvider>();

/** Returns a language model for a registry model. Shares one provider per settings value. */
export function tinyLLM(modelId: ModelId, settings: TinyLLMProviderSettings = {}): LanguageModelV4 {
  const key = settingsKey(settings);
  let provider = sharedProviders.get(key);
  if (!provider) {
    provider = createTinyLLMProvider(settings);
    sharedProviders.set(key, provider);
  }
  return provider.languageModel(modelId);
}

export function createTinyLLMProvider(settings: TinyLLMProviderSettings = {}): TinyLLMProvider {
  const instances = new Map<ModelId, TinyLLM>();

  const instanceFor = (modelId: ModelId): TinyLLM => {
    let instance = instances.get(modelId);
    if (!instance) {
      instance = createTinyLLM({ ...settings, model: modelId });
      instances.set(modelId, instance);
    }
    return instance;
  };

  const languageModel = (modelId: ModelId): LanguageModelV4 =>
    languageModelFor(modelId, instanceFor(modelId));

  const provider = ((modelId: ModelId) => languageModel(modelId)) as TinyLLMProvider;
  provider.languageModel = languageModel;
  return provider;
}

function settingsKey(settings: TinyLLMProviderSettings): string {
  // Functions cannot be serialized, so they are left out of the key. See the note on TinyLLMProviderSettings.
  return JSON.stringify(settings, (_key, value: unknown) =>
    typeof value === "function" ? undefined : value,
  );
}
