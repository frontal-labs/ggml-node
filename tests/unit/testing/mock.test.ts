import { generateObject, generateText, streamText } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMockGgmlNode, mockModel } from "@/testing/index.js";

describe("createMockGgmlNode", () => {
  it("echoes the last user message by default", async () => {
    const ai = createMockGgmlNode();
    const r = await ai.generate({ prompt: "hello there" });
    expect(r.text).toBe("echo: hello there");
    expect(r.finishReason).toBe("stop");
  });

  it("plays a list of replies in order and cycles", async () => {
    const ai = createMockGgmlNode({ respond: ["one", "two"] });
    expect((await ai.generate({ prompt: "x" })).text).toBe("one");
    expect((await ai.generate({ prompt: "x" })).text).toBe("two");
    expect((await ai.generate({ prompt: "x" })).text).toBe("one");
  });

  it("calls a responder function with the request messages", async () => {
    const ai = createMockGgmlNode({ respond: ({ messages }) => `${messages.length} messages` });
    const r = await ai.generate({
      messages: [
        { content: "s", role: "system" },
        { content: "u", role: "user" },
      ],
    });
    expect(r.text).toBe("2 messages");
  });

  it("streams in chunks of tokensPerChunk words", async () => {
    const ai = createMockGgmlNode({ respond: "a b c d e", tokensPerChunk: 2 });
    const s = ai.stream({ prompt: "x" });
    const pieces: string[] = [];
    for await (const piece of s.textStream) {
      pieces.push(piece);
    }
    expect(pieces).toEqual(["a b", " c d", " e"]);
    expect((await s.result).text).toBe("a b c d e");
  });

  it("object() parses the reply as JSON and checks it with the schema", async () => {
    const ai = createMockGgmlNode({ respond: '{"label":"spam"}' });
    const r = await ai.object({ prompt: "x", schema: z.object({ label: z.string() }) });
    expect(r.object).toEqual({ label: "spam" });
  });

  it("reports the same info shape as the real backend", async () => {
    const ai = createMockGgmlNode({ respond: "x" });
    const info = await ai.ready();
    expect(info).toMatchObject({ backend: "llama-cpp", id: "custom", license: "unknown" });
    await ai.unload();
    expect(ai.info()).toBeNull();
  });
});

describe("mockModel", () => {
  it("works with generateText", async () => {
    const r = await generateText({ model: mockModel({ respond: "hi there" }), prompt: "x" });
    expect(r.text).toBe("hi there");
  });

  it("works with streamText", async () => {
    const result = streamText({ model: mockModel({ respond: "one two" }), prompt: "x" });
    let text = "";
    for await (const delta of result.textStream) {
      text += delta;
    }
    expect(text).toBe("one two");
  });

  it("works with generateObject", async () => {
    const r = await generateObject({
      model: mockModel({ respond: '{"n":3}' }),
      prompt: "x",
      schema: z.object({ n: z.number() }),
    });
    expect(r.object).toEqual({ n: 3 });
  });
});
