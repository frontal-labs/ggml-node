import { describe, expect, it } from "vitest";
import { assertPublicTypes } from "../types/public-api.js";

describe("public type contract (Section 3)", () => {
  it("exposes the compile-time assertions (checked by bun run typecheck)", () => {
    expect(typeof assertPublicTypes).toBe("function");
  });
});
