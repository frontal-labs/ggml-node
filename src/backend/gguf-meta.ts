// biome-ignore-all lint/style/useErrorCause: TinyLLMError takes its cause inside the options object (see src/core/errors.ts)
import { stat } from "node:fs/promises";
import { TinyLLMError } from "@/core/errors.js";
import type { KvShape } from "@/core/memory.js";

export interface ModelMeta {
  shape: KvShape;
  sizeBytes: number;
  trainContextSize: number;
}

/**
 * Reads the metadata the core needs (context length, attention shape, size) from a GGUF file.
 * Only the header is read. `node-llama-cpp` is imported here, on first use.
 */
export async function readModelMeta(path: string): Promise<ModelMeta> {
  const { readGgufFileInfo } = await import("node-llama-cpp");
  const sizeBytes = (await stat(path)).size;

  let info: Awaited<ReturnType<typeof readGgufFileInfo>>;
  try {
    info = await readGgufFileInfo(path, { readTensorInfo: false });
  } catch (err) {
    throw new TinyLLMError("INVALID_OPTIONS", `${path} is not a readable GGUF file`, {
      cause: err,
      hint: "Check the path. Custom models must be GGUF files.",
    });
  }

  const arch = info.metadata.general.architecture;
  const meta = info.metadata as unknown as Record<string, Record<string, unknown> | undefined>;
  const block = meta[arch] ?? {};
  const attention = (block.attention ?? {}) as Record<string, unknown>;

  const trainContextSize = num(block.context_length, `${arch}.context_length`, path);
  const blockCount = num(block.block_count, `${arch}.block_count`, path);
  const headCount = num(attention.head_count, `${arch}.attention.head_count`, path);
  const headCountKv =
    typeof attention.head_count_kv === "number" ? attention.head_count_kv : headCount;
  const embedding = num(block.embedding_length, `${arch}.embedding_length`, path);
  const keyLength =
    typeof attention.key_length === "number" ? attention.key_length : embedding / headCount;
  const valueLength =
    typeof attention.value_length === "number" ? attention.value_length : embedding / headCount;

  return {
    shape: { blockCount, headCountKv, keyLength, valueLength },
    sizeBytes,
    trainContextSize,
  };
}

function num(value: unknown, key: string, path: string): number {
  if (typeof value !== "number") {
    throw new TinyLLMError("INVALID_OPTIONS", `GGUF file ${path} has no ${key}`, {
      hint: "The file may be truncated or not a text-generation model.",
    });
  }
  return value;
}
