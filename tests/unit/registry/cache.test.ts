import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCacheDir, resolveOffline } from "@/registry/cache.js";

describe("resolveCacheDir", () => {
  it("prefers the explicit option over the environment", () => {
    expect(
      resolveCacheDir({
        cacheDir: "/opt/models",
        env: { NODE_SLM_CACHE_DIR: "/env" },
        platform: "linux",
      }),
    ).toBe("/opt/models");
  });

  it("uses NODE_SLM_CACHE_DIR before the OS default", () => {
    expect(
      resolveCacheDir({ env: { NODE_SLM_CACHE_DIR: "/env" }, home: "/h", platform: "darwin" }),
    ).toBe("/env");
  });

  it("uses the macOS cache directory", () => {
    expect(resolveCacheDir({ env: {}, home: "/Users/x", platform: "darwin" })).toBe(
      "/Users/x/Library/Caches/node-slm",
    );
  });

  it("uses XDG_CACHE_HOME on Linux, then ~/.cache", () => {
    expect(
      resolveCacheDir({ env: { XDG_CACHE_HOME: "/xdg" }, home: "/h", platform: "linux" }),
    ).toBe("/xdg/node-slm");
    expect(resolveCacheDir({ env: {}, home: "/h", platform: "linux" })).toBe("/h/.cache/node-slm");
  });

  it("uses LOCALAPPDATA on Windows", () => {
    expect(
      resolveCacheDir({ env: { LOCALAPPDATA: "C:\\L" }, home: "C:\\h", platform: "win32" }),
    ).toBe(join("C:\\L", "node-slm", "cache"));
  });
});

describe("resolveOffline", () => {
  it("is on when the option is true", () => {
    expect(resolveOffline(true, {})).toBe(true);
  });

  it("is turned on by NODE_SLM_OFFLINE=1 or true, even when the option is false", () => {
    expect(resolveOffline(undefined, { NODE_SLM_OFFLINE: "1" })).toBe(true);
    expect(resolveOffline(false, { NODE_SLM_OFFLINE: "true" })).toBe(true);
    expect(resolveOffline(undefined, { NODE_SLM_OFFLINE: "0" })).toBe(false);
    expect(resolveOffline(undefined, {})).toBe(false);
  });
});
