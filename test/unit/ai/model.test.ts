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
import { languageModelFor, mapPrompt } from "../../../src/ai/model.js";
import { isInboardError } from "../../../src/core/errors.js";
import { createInboardWithDeps } from "../../../src/core/inboard.js";
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
      { role: "system", content: "be brief" },
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          { type: "text", text: "there" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ]);
    expect(messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi\nthere" },
      { role: "assistant", content: "hello" },
    ]);
    expect(warnings).toEqual([]);
  });

  it("warns and drops image and file parts instead of failing", () => {
    const { messages, warnings } = mapPrompt([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          {
            type: "file",
            mediaType: "image/png",
            data: { type: "data", data: new Uint8Array([1]) },
          },
        ],
      },
    ]);
    expect(messages).toEqual([{ role: "user", content: "what is this?" }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ type: "unsupported", feature: "file or image input" });
  });

  it("warns for tool results and drops the tool role", () => {
    const { messages, warnings } = mapPrompt([
      { role: "user", content: [{ type: "text", text: "go" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "1",
            toolName: "t",
            output: { type: "text", value: "x" },
          },
        ],
      },
    ] as unknown as LanguageModelV4Prompt);
    expect(messages).toEqual([{ role: "user", content: "go" }]);
    expect(warnings.some((w) => featureOf(w) === "tool results")).toBe(true);
  });
});

describe("InboardLanguageModel", () => {
  let dir: string;
  let backend: FakeBackend;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "inboard-model-"));
    await writeFile(join(dir, "m.gguf"), Buffer.alloc(100));
    backend = createFakeBackend({ respond: (messages) => `reply to ${messages.at(-1)?.content}` });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function model() {
    const inboard = createInboardWithDeps(
      { model: { path: join(dir, "m.gguf") } },
      {
        createBackend: () => backend,
        readMeta: async () => ({ sizeBytes: 100, trainContextSize: 4096, shape: SHAPE }),
        memory: {
          availableSystemBytes: async () => 1e12,
          cgroupLimitBytes: async () => undefined,
          cgroupCurrentBytes: async () => undefined,
        },
        env: { INBOARD_CACHE_DIR: dir },
      },
    );
    return languageModelFor("qwen2.5-0.5b", inboard);
  }

  it("has the v4 spec identity fields", () => {
    const m = model();
    expect(m.specificationVersion).toBe("v4");
    expect(m.provider).toBe("inboard");
    expect(m.modelId).toBe("qwen2.5-0.5b");
  });

  it("doGenerate returns text content, finish reason, usage and warnings", async () => {
    const r = await model().doGenerate(
      callOptions([{ role: "user", content: [{ type: "text", text: "hello world" }] }], {
        maxOutputTokens: 64,
        temperature: 0,
      }),
    );
    expect(r.content).toEqual([{ type: "text", text: "reply to hello world" }]);
    expect(r.finishReason.unified).toBe("stop");
    expect(r.usage.outputTokens.total).toBe(4);
    expect(r.usage.inputTokens.total).toBeGreaterThan(0);
    expect(r.warnings).toEqual([]);
  });

  it("doGenerate maps finish reason length", async () => {
    backend = createFakeBackend({ respond: () => "a b c d e f g h" });
    const r = await model().doGenerate(
      callOptions([{ role: "user", content: [{ type: "text", text: "x" }] }], {
        maxOutputTokens: 3,
      }),
    );
    expect(r.finishReason.unified).toBe("length");
  });

  it("warns for tool definitions and ignores them", async () => {
    const r = await model().doGenerate(
      callOptions([{ role: "user", content: [{ type: "text", text: "x" }] }], {
        tools: [{ type: "function", name: "lookup", inputSchema: { type: "object" } }],
      }),
    );
    expect(r.warnings.some((w) => featureOf(w) === "tools")).toBe(true);
  });

  it("throws INVALID_OPTIONS for a required tool choice", async () => {
    const err = await model()
      .doGenerate(
        callOptions([{ role: "user", content: [{ type: "text", text: "x" }] }], {
          toolChoice: { type: "required" },
        }),
      )
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(isInboardError(err) && err.code).toBe("INVALID_OPTIONS");
  });

  it("doStream emits the spec part sequence in order", async () => {
    const { stream } = await model().doStream(
      callOptions([{ role: "user", content: [{ type: "text", text: "one two" }] }], {
        temperature: 0,
      }),
    );
    const parts: LanguageModelV4StreamPart[] = [];
    for await (const part of stream) parts.push(part);

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
    expect(finish).toMatchObject({ type: "finish", finishReason: { unified: "stop" } });
  });

  it("doStream with a JSON schema emits the grammar output as one delta", async () => {
    backend = createFakeBackend({ respond: () => '{"label":"ham"}' });
    const { stream } = await model().doStream(
      callOptions([{ role: "user", content: [{ type: "text", text: "classify" }] }], {
        responseFormat: {
          type: "json",
          schema: { type: "object", properties: { label: { type: "string" } } },
        },
      }),
    );
    const deltas: string[] = [];
    for await (const part of stream) if (part.type === "text-delta") deltas.push(part.delta);
    expect(deltas).toEqual(['{"label":"ham"}']);
    expect(backend.grammarBuilds).toBe(1);
  });

  it("json response format without a schema warns that output is not guaranteed", async () => {
    const r = await model().doGenerate(
      callOptions([{ role: "user", content: [{ type: "text", text: "json please" }] }], {
        responseFormat: { type: "json" },
      }),
    );
    expect(r.warnings.some((w) => featureOf(w) === "responseFormat without schema")).toBe(true);
  });
});
