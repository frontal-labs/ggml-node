import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCacheDir, resolveOffline } from "@/registry/cache.js";

describe("resolveCacheDir", () => {
  it("prefers the explicit option over the environment", () => {
    expect(
      resolveCacheDir({
        cacheDir: "/opt/models",
        env: { LOCAL_LLM_CACHE_DIR: "/env" },
        platform: "linux",
      }),
    ).toBe("/opt/models");
  });

  it("uses LOCAL_LLM_CACHE_DIR before the OS default", () => {
    expect(
      resolveCacheDir({ env: { LOCAL_LLM_CACHE_DIR: "/env" }, home: "/h", platform: "darwin" }),
    ).toBe("/env");
  });

  it("uses the macOS cache directory", () => {
    expect(resolveCacheDir({ env: {}, home: "/Users/x", platform: "darwin" })).toBe(
      "/Users/x/Library/Caches/local-llm",
    );
  });

  it("uses XDG_CACHE_HOME on Linux, then ~/.cache", () => {
    expect(
      resolveCacheDir({ env: { XDG_CACHE_HOME: "/xdg" }, home: "/h", platform: "linux" }),
    ).toBe("/xdg/local-llm");
    expect(resolveCacheDir({ env: {}, home: "/h", platform: "linux" })).toBe("/h/.cache/local-llm");
  });

  it("uses LOCALAPPDATA on Windows", () => {
    expect(
      resolveCacheDir({ env: { LOCALAPPDATA: "C:\\L" }, home: "C:\\h", platform: "win32" }),
    ).toBe(join("C:\\L", "local-llm", "cache"));
  });
});

describe("resolveOffline", () => {
  it("is on when the option is true", () => {
    expect(resolveOffline(true, {})).toBe(true);
  });

  it("is turned on by LOCAL_LLM_OFFLINE=1 or true, even when the option is false", () => {
    expect(resolveOffline(undefined, { LOCAL_LLM_OFFLINE: "1" })).toBe(true);
    expect(resolveOffline(false, { LOCAL_LLM_OFFLINE: "true" })).toBe(true);
    expect(resolveOffline(undefined, { LOCAL_LLM_OFFLINE: "0" })).toBe(false);
    expect(resolveOffline(undefined, {})).toBe(false);
  });
});
