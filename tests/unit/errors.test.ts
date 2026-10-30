import { describe, expect, it } from "vitest";
import { INBOARD_ERROR_CODES, InboardError, isInboardError } from "@/index.js";

describe("InboardError", () => {
  it("carries code, hint and cause", () => {
    const cause = new Error("disk full");
    const err = new InboardError("DOWNLOAD_FAILED", "download failed", {
      hint: "Run: npx inboard pull qwen2.5-0.5b",
      cause,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InboardError");
    expect(err.code).toBe("DOWNLOAD_FAILED");
    expect(err.hint).toBe("Run: npx inboard pull qwen2.5-0.5b");
    expect(err.cause).toBe(cause);
    expect(isInboardError(err)).toBe(true);
    expect(isInboardError(new Error("x"))).toBe(false);
  });

  it("enumerates exactly the codes in Section 3.3", () => {
    expect([...INBOARD_ERROR_CODES].sort()).toEqual(
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
