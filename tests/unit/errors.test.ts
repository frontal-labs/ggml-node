import { describe, expect, it } from "vitest";
import { GGML_NODE_ERROR_CODES, GgmlNodeError, isGgmlNodeError } from "@/index.js";

describe("GgmlNodeError", () => {
  it("carries code, hint and cause", () => {
    const cause = new Error("disk full");
    const err = new GgmlNodeError("DOWNLOAD_FAILED", "download failed", {
      cause,
      hint: "Run: npx ggml-node pull qwen2.5-0.5b",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("GgmlNodeError");
    expect(err.code).toBe("DOWNLOAD_FAILED");
    expect(err.hint).toBe("Run: npx ggml-node pull qwen2.5-0.5b");
    expect(err.cause).toBe(cause);
    expect(isGgmlNodeError(err)).toBe(true);
    expect(isGgmlNodeError(new Error("x"))).toBe(false);
  });

  it("enumerates exactly the codes in Section 3.3", () => {
    expect([...GGML_NODE_ERROR_CODES].sort()).toEqual(
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
