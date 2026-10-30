import { describe, expect, it } from "vitest";
import { isInboardError } from "@/core/errors.js";
import { fitToBudget, normalizeRequest } from "@/core/prompt.js";
import type { Message } from "@/core/types.js";

const countWords = async (messages: Message[]) =>
  messages.reduce((n, m) => n + m.content.split(" ").length, 0);

async function codeOf(fn: () => unknown): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (err) {
    return isInboardError(err) ? err.code : "NOT_INBOARD";
  }
}

describe("normalizeRequest", () => {
  it("turns prompt into one user message and prepends system", () => {
    const r = normalizeRequest({ prompt: "hi", system: "be brief" });
    expect(r.messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ]);
    expect(r.maxTokens).toBe(256);
    expect(r.temperature).toBe(0.7);
    expect(r.overflow).toBe("error");
  });

  it("requires exactly one of prompt or messages", async () => {
    expect(await codeOf(() => normalizeRequest({}))).toBe("INVALID_OPTIONS");
    expect(
      await codeOf(() =>
        normalizeRequest({ prompt: "a", messages: [{ role: "user", content: "b" }] }),
      ),
    ).toBe("INVALID_OPTIONS");
  });

  it("rejects an empty messages array", async () => {
    expect(await codeOf(() => normalizeRequest({ messages: [] }))).toBe("INVALID_OPTIONS");
  });

  it("rejects a system message given twice", async () => {
    expect(
      await codeOf(() =>
        normalizeRequest({ messages: [{ role: "system", content: "a" }], system: "b" }),
      ),
    ).toBe("INVALID_OPTIONS");
  });

  it("validates numeric options", async () => {
    expect(await codeOf(() => normalizeRequest({ prompt: "x", maxTokens: 0 }))).toBe(
      "INVALID_OPTIONS",
    );
    expect(await codeOf(() => normalizeRequest({ prompt: "x", temperature: 5 }))).toBe(
      "INVALID_OPTIONS",
    );
    expect(await codeOf(() => normalizeRequest({ prompt: "x", topP: 0 }))).toBe("INVALID_OPTIONS");
    expect(await codeOf(() => normalizeRequest({ prompt: "x", stop: [""] }))).toBe(
      "INVALID_OPTIONS",
    );
  });
});

describe("fitToBudget", () => {
  const convo: Message[] = [
    { role: "system", content: "sys one" },
    { role: "user", content: "first question here" },
    { role: "assistant", content: "first answer here" },
    { role: "user", content: "second question here" },
    { role: "assistant", content: "second answer here" },
    { role: "user", content: "final question" },
  ];

  it("returns the messages unchanged when they fit", async () => {
    expect(await fitToBudget(convo, 1000, "error", countWords)).toEqual(convo);
  });

  it("throws CONTEXT_OVERFLOW under the error policy", async () => {
    const err = await fitToBudget(convo, 3, "error", countWords).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isInboardError(err) && err.code).toBe("CONTEXT_OVERFLOW");
  });

  it("truncate-start drops the oldest removable messages and keeps system and last user", async () => {
    const out = await fitToBudget(convo, 12, "truncate-start", countWords);
    expect(out[0]).toEqual(convo[0]);
    expect(out.at(-1)).toEqual(convo.at(-1));
    expect(await countWords(out)).toBeLessThanOrEqual(12);
    expect(out.some((m) => m.content === "first question here")).toBe(false);
  });

  it("truncate-middle keeps the first removable message and the most recent turns", async () => {
    const out = await fitToBudget(convo, 12, "truncate-middle", countWords);
    expect(out[0]).toEqual(convo[0]);
    expect(out.at(-1)).toEqual(convo.at(-1));
    expect(await countWords(out)).toBeLessThanOrEqual(12);
  });

  it("throws CONTEXT_OVERFLOW when even system plus last user cannot fit", async () => {
    const err = await fitToBudget(convo, 1, "truncate-start", countWords).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isInboardError(err) && err.code).toBe("CONTEXT_OVERFLOW");
  });
});
