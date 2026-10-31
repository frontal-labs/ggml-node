/**
 * Hand-maintained registry sources. `scripts/compute-checksums.ts` downloads each entry,
 * computes its SHA-256 and size, reads the context length from the GGUF metadata, and
 * writes `src/registry/models.ts`. Edit this file, then run `bun run registry:generate`.
 *
 * Every entry must point to a real file. Do not add an entry until its URL resolves.
 */
export interface RegistrySource {
  displayName: string;
  file: string;
  hfRepo: string;
  id: string;
  license: string;
  licenseUrl: string;
  notes: string;
}

const APACHE_2 = "https://www.apache.org/licenses/LICENSE-2.0";

export const MODEL_SOURCES = [
  {
    displayName: "Qwen2.5 0.5B Instruct (Q4_K_M)",
    file: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    hfRepo: "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
    id: "qwen2.5-0.5b",
    license: "Apache-2.0",
    licenseUrl: APACHE_2,
    notes: "Default model. Fast enough for classification, extraction and short rewrites.",
  },
  {
    displayName: "Qwen2.5 1.5B Instruct (Q4_K_M)",
    file: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
    hfRepo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
    id: "qwen2.5-1.5b",
    license: "Apache-2.0",
    licenseUrl: APACHE_2,
    notes: "Larger than the default. Better output quality, roughly 3x the memory.",
  },
  {
    displayName: "SmolLM2 360M Instruct (Q8_0)",
    file: "smollm2-360m-instruct-q8_0.gguf",
    hfRepo: "HuggingFaceTB/SmolLM2-360M-Instruct-GGUF",
    id: "smollm2-360m",
    license: "Apache-2.0",
    licenseUrl: APACHE_2,
    notes: "Smallest option. Q8_0 because the Q4_K_M file is not published in this repo.",
  },
  {
    displayName: "BGE Small English v1.5 (Q8_0)",
    file: "bge-small-en-v1.5-q8_0.gguf",
    hfRepo: "CompendiumLabs/bge-small-en-v1.5-gguf",
    id: "bge-small-en-v1.5",
    license: "MIT",
    licenseUrl: "https://opensource.org/licenses/MIT",
    notes:
      "Embedding model: use embed(), not generate(). 384 dimensions, 512-token context. Q8_0 build of BAAI/bge-small-en-v1.5.",
  },
] as const satisfies readonly RegistrySource[];
