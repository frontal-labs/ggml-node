import { describe, expect, it } from "vitest";
import { createInboard } from "../../src/index.js";

/**
 * Real model, real backend. Opt-in: set INBOARD_E2E=1. Downloads the default model on first run.
 */
const enabled = process.env.INBOARD_E2E === "1";

describe.skipIf(!enabled)("e2e: default model", () => {
  const ai = createInboard({ model: "qwen2.5-0.5b", maxConcurrency: 1 });

  it("loads and generates text with usage and timing", async () => {
    const r = await ai.generate({
      messages: [
        { role: "system", content: "Answer in one short sentence." },
        { role: "user", content: "What is the capital of France?" },
      ],
      maxTokens: 48,
      temperature: 0,
      seed: 1,
    });
    expect(r.text.trim().length).toBeGreaterThan(0);
    expect(r.model).toBe("qwen2.5-0.5b");
    expect(r.usage.inputTokens).toBeGreaterThan(0);
    expect(r.usage.outputTokens).toBeGreaterThan(0);
    expect(r.timing.totalMs).toBeGreaterThan(0);
    expect(["stop", "length"]).toContain(r.finishReason);
  }, 120_000);

  it("streams deltas whose join equals the final text", async () => {
    const s = ai.stream({ prompt: "Name three colours.", maxTokens: 32, temperature: 0, seed: 2 });
    const pieces: string[] = [];
    for await (const piece of s.textStream) pieces.push(piece);
    const r = await s.result;
    expect(pieces.join("")).toBe(r.text);
    expect(pieces.length).toBeGreaterThan(1);
  }, 120_000);

  it("keeps the event loop responsive during generation (p95 lag under 50 ms)", async () => {
    const lags: number[] = [];
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      lags.push(now - last - 10);
      last = now;
    }, 10);
    try {
      await ai.generate({
        prompt: "Write a short paragraph about rivers.",
        maxTokens: 128,
        temperature: 0.7,
      });
    } finally {
      clearInterval(timer);
    }
    const sorted = [...lags].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    expect(p95).toBeLessThan(50);
  }, 120_000);

  it("aborts a running generation and resolves the stream with finishReason abort", async () => {
    const s = ai.stream({
      prompt: "Tell a long story about a lighthouse.",
      maxTokens: 256,
      temperature: 0.7,
    });
    let count = 0;
    for await (const _ of s.textStream) {
      void _;
      count += 1;
      if (count === 3) s.abort();
    }
    const r = await s.result;
    expect(r.finishReason).toBe("abort");
  }, 120_000);

  it("unloads, then reloads on the next call", async () => {
    await ai.unload();
    expect(ai.info()).toBeNull();
    const r = await ai.generate({ prompt: "Say hi.", maxTokens: 8, temperature: 0 });
    expect(r.text.length).toBeGreaterThan(0);
    await ai.unload();
  }, 120_000);
});
