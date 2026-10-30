/**
 * Hand-maintained registry sources. `scripts/compute-checksums.ts` downloads each entry,
 * computes its SHA-256 and size, reads the context length from the GGUF metadata, and
 * writes `src/registry/models.ts`. Edit this file, then run `pnpm registry:generate`.
 *
 * Every entry must point to a real file. Do not add an entry until its URL resolves.
 */
export interface RegistrySource {
  id: string;
  displayName: string;
  hfRepo: string;
  file: string;
  license: string;
  licenseUrl: string;
  notes: string;
}

const APACHE_2 = "https://www.apache.org/licenses/LICENSE-2.0";

export const MODEL_SOURCES = [
  {
    id: "qwen2.5-0.5b",
    displayName: "Qwen2.5 0.5B Instruct (Q4_K_M)",
    hfRepo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
    file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    license: "Apache-2.0",
    licenseUrl: APACHE_2,
    notes: "Default model. Fast enough for classification, extraction and short rewrites.",
  },
  {
    id: "qwen2.5-1.5b",
    displayName: "Qwen2.5 1.5B Instruct (Q4_K_M)",
    hfRepo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
    file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
    license: "Apache-2.0",
    licenseUrl: APACHE_2,
    notes: "Larger than the default. Better output quality, roughly 3x the memory.",
  },
  {
    id: "smollm2-360m",
    displayName: "SmolLM2 360M Instruct (Q8_0)",
    hfRepo: "HuggingFaceTB/SmolLM2-360M-Instruct-GGUF",
    file: "smollm2-360m-instruct-q8_0.gguf",
    license: "Apache-2.0",
    licenseUrl: APACHE_2,
    notes: "Smallest option. Q8_0 because the Q4_K_M file is not published in this repo.",
  },
] as const satisfies readonly RegistrySource[];
