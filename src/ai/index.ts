// M1 stub: the AI SDK provider lands in M5.
import type { LanguageModelV4 } from "@ai-sdk/provider";

export type { ModelId } from "../registry/models.js";

export interface InboardProviderSettings {
  maxConcurrency?: number;
  cacheDir?: string;
}

export type InboardProvider = (modelId: string) => LanguageModelV4;

export function inboard(_modelId: string, _settings?: InboardProviderSettings): LanguageModelV4 {
  throw new Error("inboard/ai: not implemented yet (M5)");
}

export function createInboardProvider(_settings?: InboardProviderSettings): InboardProvider {
  throw new Error("inboard/ai: not implemented yet (M5)");
}
