// M1 placeholder: the typed manifest with verified URLs and checksums lands in M2.
// Until then only the ids are declared, so the public `ModelId` type is final.
export const MODEL_IDS = ["qwen2.5-0.5b", "qwen2.5-1.5b", "smollm2-360m"] as const;

export type ModelId = (typeof MODEL_IDS)[number];
