import { describe, expect, it } from "vitest";
import { isInboardError } from "@/core/errors.js";
import {
  availableMemoryBytes,
  estimateKvBytes,
  estimateModelBytes,
  preflight,
} from "@/core/memory.js";

const shape = { blockCount: 24, headCountKv: 2, keyLength: 64, valueLength: 64 };

describe("memory estimates", () => {
  it("computes KV bytes as layers × KV heads × (K+V dims) × tokens × f16 × sequences", () => {
    // 24 * 2 * 128 * 2048 * 2 bytes per sequence, two sequences
    expect(estimateKvBytes(shape, 2048, 2)).toBe(24 * 2 * 128 * 2048 * 2 * 2);
  });

  it("adds the weights to the KV estimate", () => {
    expect(estimateModelBytes(1000, shape, 2048, 1)).toBe(1000 + estimateKvBytes(shape, 2048, 1));
  });

  it("uses the cgroup headroom when it is smaller than free memory", async () => {
    const readers = {
      availableSystemBytes: async () => 8_000,
      cgroupLimitBytes: async () => 5_000,
      cgroupCurrentBytes: async () => 1_000,
    };
    expect(await availableMemoryBytes(readers)).toBe(4_000);
  });

  it("uses free memory when there is no cgroup limit", async () => {
    const readers = {
      availableSystemBytes: async () => 8_000,
      cgroupLimitBytes: async () => undefined,
      cgroupCurrentBytes: async () => undefined,
    };
    expect(await availableMemoryBytes(readers)).toBe(8_000);
  });

  it("throws OUT_OF_MEMORY with a hint when the estimate does not fit", async () => {
    const readers = {
      availableSystemBytes: async () => 1000,
      cgroupLimitBytes: async () => undefined,
      cgroupCurrentBytes: async () => undefined,
    };
    const err = await preflight({
      estimateBytes: 5000,
      contextSize: 4096,
      sequences: 2,
      readers,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isInboardError(err) && err.code).toBe("OUT_OF_MEMORY");
    expect(isInboardError(err) && err.hint).toContain("contextSize");
  });

  it("passes when the estimate fits", async () => {
    const readers = {
      availableSystemBytes: async () => 10_000,
      cgroupLimitBytes: async () => undefined,
      cgroupCurrentBytes: async () => undefined,
    };
    await expect(
      preflight({ estimateBytes: 5000, contextSize: 4096, sequences: 1, readers }),
    ).resolves.toBeUndefined();
  });
});
