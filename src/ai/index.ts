import type { LanguageModelV4 } from "@ai-sdk/provider";
import { languageModelFor } from "@/ai/model.js";
import { createLocalLLM } from "@/core/local-llm.js";
import type { LocalLLM, LocalLLMOptions, ModelId } from "@/core/types.js";

export type { ModelId } from "@/registry/models.js";

/**
 * AI SDK provider for LocalLLM. Works with `generateText`, `streamText` and `generateObject` from
 * `ai` (spec v4, `@ai-sdk/provider` 4.x).
 *
 * Settings are the same as `createLocalLLM`, minus `model`, which comes from the call. Two calls
 * with the same model and settings share one loaded instance. The `onEvent` callback is not part of
 * that key, so pass the same settings object shape to share an instance.
 */
export type LocalLLMProviderSettings = Omit<LocalLLMOptions, "model">;

export interface LocalLLMProvider {
  languageModel: (modelId: ModelId) => LanguageModelV4;
  (modelId: ModelId): LanguageModelV4;
}

/** One provider per settings key, shared by `localLLM()`. */
const sharedProviders = new Map<string, LocalLLMProvider>();

/** Returns a language model for a registry model. Shares one provider per settings value. */
export function localLLM(
  modelId: ModelId,
  settings: LocalLLMProviderSettings = {},
): LanguageModelV4 {
  const key = settingsKey(settings);
  let provider = sharedProviders.get(key);
  if (!provider) {
    provider = createLocalLLMProvider(settings);
    sharedProviders.set(key, provider);
  }
  return provider.languageModel(modelId);
}

export function createLocalLLMProvider(settings: LocalLLMProviderSettings = {}): LocalLLMProvider {
  const instances = new Map<ModelId, LocalLLM>();

  const instanceFor = (modelId: ModelId): LocalLLM => {
    let instance = instances.get(modelId);
    if (!instance) {
      instance = createLocalLLM({ ...settings, model: modelId });
      instances.set(modelId, instance);
    }
    return instance;
  };

  const languageModel = (modelId: ModelId): LanguageModelV4 =>
    languageModelFor(modelId, instanceFor(modelId));

  const provider = ((modelId: ModelId) => languageModel(modelId)) as LocalLLMProvider;
  provider.languageModel = languageModel;
  return provider;
}

function settingsKey(settings: LocalLLMProviderSettings): string {
  // Functions cannot be serialized, so they are left out of the key. See the note on LocalLLMProviderSettings.
  return JSON.stringify(settings, (_key, value: unknown) =>
    typeof value === "function" ? undefined : value,
  );
}
