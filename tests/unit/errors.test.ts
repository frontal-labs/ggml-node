import { describe, expect, it } from "vitest";
import { isLocalLLMError, LOCAL_LLM_ERROR_CODES, LocalLLMError } from "@/index.js";

describe("LocalLLMError", () => {
  it("carries code, hint and cause", () => {
    const cause = new Error("disk full");
    const err = new LocalLLMError("DOWNLOAD_FAILED", "download failed", {
      cause,
      hint: "Run: npx local-llm pull qwen2.5-0.5b",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("LocalLLMError");
    expect(err.code).toBe("DOWNLOAD_FAILED");
    expect(err.hint).toBe("Run: npx local-llm pull qwen2.5-0.5b");
    expect(err.cause).toBe(cause);
    expect(isLocalLLMError(err)).toBe(true);
    expect(isLocalLLMError(new Error("x"))).toBe(false);
  });

  it("enumerates exactly the codes in Section 3.3", () => {
    expect([...LOCAL_LLM_ERROR_CODES].sort()).toEqual(
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
