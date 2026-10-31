import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateObject, generateText, streamText } from "ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { languageModelFor } from "@/ai/model.js";
import { createGgmlNodeWithDeps } from "@/core/ggml-node.js";
import { createFakeBackend } from "../../helpers/fake-backend.js";

/**
 * The AI SDK's own functions against the provider, with the fake backend. No native code.
 */
describe("AI SDK integration (fake backend)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ggml-node-"));
    await writeFile(join(dir, "m.gguf"), Buffer.alloc(100));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  function modelWith(respond: (messages: { role: string; content: string }[]) => string) {
    const backend = createFakeBackend({ respond });
    const llm = createGgmlNodeWithDeps(
      { model: { path: join(dir, "m.gguf") } },
      {
        createBackend: () => backend,
        env: { GGML_NODE_CACHE_DIR: dir },
        memory: {
          availableSystemBytes: async () => 1e12,
          cgroupCurrentBytes: async () => undefined,
          cgroupLimitBytes: async () => undefined,
        },
        readMeta: async () => ({
          kind: "generation",
          shape: { blockCount: 1, headCountKv: 1, keyLength: 8, valueLength: 8 },
          sizeBytes: 100,
          trainContextSize: 4096,
        }),
      },
    );
    return languageModelFor("qwen2.5-0.5b", llm);
  }

  it("generateText returns the text and usage", async () => {
    const model = modelWith((m) => `echo ${m.at(-1)?.content}`);
    const r = await generateText({ model, prompt: "hello there" });
    expect(r.text).toBe("echo hello there");
    expect(r.finishReason).toBe("stop");
    expect(r.usage.outputTokens).toBe(3);
  });

  it("streamText yields the same text as its final result", async () => {
    const model = modelWith(() => "one two three");
    const result = streamText({ model, prompt: "count" });
    let streamed = "";
    for await (const delta of result.textStream) {
      streamed += delta;
    }
    expect(streamed).toBe("one two three");
    expect(await result.text).toBe("one two three");
  });

  it("generateObject returns a value that matches the Zod schema", async () => {
    const schema = z.object({ label: z.enum(["spam", "ham"]), score: z.number() });
    const model = modelWith(() => '{"label":"spam","score":0.8}');
    const r = await generateObject({ model, prompt: "classify", schema });
    expect(r.object).toEqual({ label: "spam", score: 0.8 });
  });
});
