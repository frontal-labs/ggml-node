import { describe, expect, it } from "vitest";
import { MODEL_IDS, MODELS } from "@/registry/models.js";
import { MODEL_SOURCES } from "@/registry/sources.js";

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const HTTPS_URL = /^https:\/\//u;

describe("registry manifest", () => {
  it("has one generated entry per source, with matching ids and files", () => {
    expect([...MODEL_IDS].sort()).toEqual(MODEL_SOURCES.map((s) => s.id).sort());
    for (const source of MODEL_SOURCES) {
      expect(MODELS[source.id].file).toBe(source.file);
      expect(MODELS[source.id].hfRepo).toBe(source.hfRepo);
    }
  });

  it("has a verifiable URL, SHA-256 and size for every entry", () => {
    for (const entry of Object.values(MODELS)) {
      expect(entry.url).toBe(`https://huggingface.co/${entry.hfRepo}/resolve/main/${entry.file}`);
      expect(entry.sha256).toMatch(SHA256_HEX);
      expect(entry.sizeBytes).toBeGreaterThan(0);
      expect(entry.contextLength).toBeGreaterThan(0);
      expect(entry.ramEstimateBytes).toBeGreaterThan(entry.sizeBytes);
    }
  });

  it("has a license and license URL for every entry", () => {
    for (const entry of Object.values(MODELS)) {
      expect(entry.license.length).toBeGreaterThan(0);
      expect(entry.licenseUrl).toMatch(HTTPS_URL);
    }
  });

  it("keeps the default model in the registry", () => {
    expect(MODEL_IDS).toContain("qwen2.5-0.5b");
  });
});
