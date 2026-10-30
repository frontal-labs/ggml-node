import { describe, expect, it } from "vitest";
import { isTinyLLMError, TINY_LLM_ERROR_CODES, TinyLLMError } from "@/index.js";

describe("TinyLLMError", () => {
  it("carries code, hint and cause", () => {
    const cause = new Error("disk full");
    const err = new TinyLLMError("DOWNLOAD_FAILED", "download failed", {
      cause,
      hint: "Run: npx tiny-llm pull qwen2.5-0.5b",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TinyLLMError");
    expect(err.code).toBe("DOWNLOAD_FAILED");
    expect(err.hint).toBe("Run: npx tiny-llm pull qwen2.5-0.5b");
    expect(err.cause).toBe(cause);
    expect(isTinyLLMError(err)).toBe(true);
    expect(isTinyLLMError(new Error("x"))).toBe(false);
  });

  it("enumerates exactly the codes in Section 3.3", () => {
    expect([...TINY_LLM_ERROR_CODES].sort()).toEqual(
      [
        "MODEL_NOT_FOUND",
        "DOWNLOAD_FAILED",
        "CHECKSUM_MISMATCH",
        "LICENSE_NOT_ACCEPTED",
        "UNSUPPORTED_PLATFORM",
        "OUT_OF_MEMORY",
        "CONTEXT_OVERFLOW",
        "QUEUE_FULL",
        "ABORTED",
        "SCHEMA_VIOLATION",
        "INVALID_OPTIONS",
        "BACKEND_CRASHED",
      ].sort(),
    );
  });
});
