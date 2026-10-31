import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  SharedV4Warning,
} from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { languageModelFor, mapPrompt } from "@/ai/model.js";
import { isGgmlNodeError } from "@/core/errors.js";
import { createGgmlNodeWithDeps } from "@/core/ggml-node.js";
import { createFakeBackend, type FakeBackend } from "../../helpers/fake-backend.js";

const SHAPE = { blockCount: 1, headCountKv: 1, keyLength: 8, valueLength: 8 };

/** Warnings are a union; only `unsupported` warnings carry a feature name. */
function featureOf(w: SharedV4Warning): string | undefined {
  return w.type === "unsupported" ? w.feature : undefined;
}

function callOptions(
  prompt: LanguageModelV4Prompt,
  extra: Partial<LanguageModelV4CallOptions> = {},
): LanguageModelV4CallOptions {
  return { prompt, ...extra };
}

describe("mapPrompt", () => {
  it("maps system and text parts to messages", () => {
    const { messages, warnings } = mapPrompt([
      { content: "be brief", role: "system" },
      {
        content: [
          { text: "hi", type: "text" },
          { text: "there", type: "text" },
        ],
        role: "user",
      },
      { content: [{ text: "hello", type: "text" }], role: "assistant" },
    ]);
    expect(messages).toEqual([
      { content: "be brief", role: "system" },
      { content: "hi\nthere", role: "user" },
      { content: "hello", role: "assistant" },
    ]);
    expect(warnings).toEqual([]);
  });

  it("warns and drops image and file parts instead of failing", () => {
    const { messages, warnings } = mapPrompt([
      {
        content: [
          { text: "what is this?", type: "text" },
          {
            data: { data: new Uint8Array([1]), type: "data" },
            mediaType: "image/png",
            type: "file",
          },
        ],
        role: "user",
      },
    ]);
    expect(messages).toEqual([{ content: "what is this?", role: "user" }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ feature: "file or image input", type: "unsupported" });
  });

  it("warns for tool results and drops the tool role", () => {
    const { messages, warnings } = mapPrompt([
      { content: [{ text: "go", type: "text" }], role: "user" },
      {
        content: [
          {
            output: { type: "text", value: "x" },
            toolCallId: "1",
            toolName: "t",
            type: "tool-result",
          },
        ],
        role: "tool",
      },
    ] as unknown as LanguageModelV4Prompt);
    expect(messages).toEqual([{ content: "go", role: "user" }]);
    expect(warnings.some((w) => featureOf(w) === "tool results")).toBe(true);
  });
});

describe("GgmlNodeLanguageModel", () => {
  let dir: string;
  let backend: FakeBackend;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ggml-node-model-"));
    await writeFile(join(dir, "m.gguf"), Buffer.alloc(100));
    backend = createFakeBackend({ respond: (messages) => `reply to ${messages.at(-1)?.content}` });
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  function model() {
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
          shape: SHAPE,
          sizeBytes: 100,
          trainContextSize: 4096,
        }),
      },
    );
    return languageModelFor("qwen2.5-0.5b", llm);
  }

  it("has the v4 spec identity fields", () => {
    const m = model();
    expect(m.specificationVersion).toBe("v4");
    expect(m.provider).toBe("ggml-node");
    expect(m.modelId).toBe("qwen2.5-0.5b");
  });

  it("doGenerate returns text content, finish reason, usage and warnings", async () => {
    const r = await model().doGenerate(
      callOptions([{ content: [{ text: "hello world", type: "text" }], role: "user" }], {
        maxOutputTokens: 64,
        temperature: 0,
      }),
    );
    expect(r.content).toEqual([{ text: "reply to hello world", type: "text" }]);
    expect(r.finishReason.unified).toBe("stop");
    expect(r.usage.outputTokens.total).toBe(4);
    expect(r.usage.inputTokens.total).toBeGreaterThan(0);
    expect(r.warnings).toEqual([]);
  });

  it("doGenerate maps finish reason length", async () => {
    backend = createFakeBackend({ respond: () => "a b c d e f g h" });
    const r = await model().doGenerate(
      callOptions([{ content: [{ text: "x", type: "text" }], role: "user" }], {
        maxOutputTokens: 3,
      }),
    );
    expect(r.finishReason.unified).toBe("length");
  });

  it("warns for tool definitions and ignores them", async () => {
    const r = await model().doGenerate(
      callOptions([{ content: [{ text: "x", type: "text" }], role: "user" }], {
        tools: [{ inputSchema: { type: "object" }, name: "lookup", type: "function" }],
      }),
    );
    expect(r.warnings.some((w) => featureOf(w) === "tools")).toBe(true);
  });

  it("throws INVALID_OPTIONS for a required tool choice", async () => {
    const err = await model()
      .doGenerate(
        callOptions([{ content: [{ text: "x", type: "text" }], role: "user" }], {
          toolChoice: { type: "required" },
        }),
      )
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(isGgmlNodeError(err) && err.code).toBe("INVALID_OPTIONS");
  });

  it("doStream emits the spec part sequence in order", async () => {
    const { stream } = await model().doStream(
      callOptions([{ content: [{ text: "one two", type: "text" }], role: "user" }], {
        temperature: 0,
      }),
    );
    const parts: LanguageModelV4StreamPart[] = [];
    for await (const part of stream) {
      parts.push(part);
    }

    expect(parts.map((p) => p.type)).toEqual([
      "stream-start",
      "text-start",
      "text-delta",
      "text-delta",
      "text-delta",
      "text-delta",
      "text-end",
      "finish",
    ]);
    const text = parts
      .filter(
        (p): p is Extract<LanguageModelV4StreamPart, { type: "text-delta" }> =>
          p.type === "text-delta",
      )
      .map((p) => p.delta)
      .join("");
    expect(text).toBe("reply to one two");
    const finish = parts.at(-1);
    expect(finish).toMatchObject({ finishReason: { unified: "stop" }, type: "finish" });
  });

  it("doStream with a JSON schema emits the grammar output as one delta", async () => {
    backend = createFakeBackend({ respond: () => '{"label":"ham"}' });
    const { stream } = await model().doStream(
      callOptions([{ content: [{ text: "classify", type: "text" }], role: "user" }], {
        responseFormat: {
          schema: { properties: { label: { type: "string" } }, type: "object" },
          type: "json",
        },
      }),
    );
    const deltas: string[] = [];
    for await (const part of stream) {
      if (part.type === "text-delta") {
        deltas.push(part.delta);
      }
    }
    expect(deltas).toEqual(['{"label":"ham"}']);
    expect(backend.grammarBuilds).toBe(1);
  });

  it("json response format without a schema warns that output is not guaranteed", async () => {
    const r = await model().doGenerate(
      callOptions([{ content: [{ text: "json please", type: "text" }], role: "user" }], {
        responseFormat: { type: "json" },
      }),
    );
    expect(r.warnings.some((w) => featureOf(w) === "responseFormat without schema")).toBe(true);
  });
});
