import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCacheDir, resolveOffline } from "@/registry/cache.js";

describe("resolveCacheDir", () => {
  it("prefers the explicit option over the environment", () => {
    expect(
      resolveCacheDir({
        cacheDir: "/opt/models",
        env: { INBOARD_CACHE_DIR: "/env" },
        platform: "linux",
      }),
    ).toBe("/opt/models");
  });

  it("uses INBOARD_CACHE_DIR before the OS default", () => {
    expect(
      resolveCacheDir({ env: { INBOARD_CACHE_DIR: "/env" }, platform: "darwin", home: "/h" }),
    ).toBe("/env");
  });

  it("uses the macOS cache directory", () => {
    expect(resolveCacheDir({ env: {}, platform: "darwin", home: "/Users/x" })).toBe(
      "/Users/x/Library/Caches/inboard",
    );
  });

  it("uses XDG_CACHE_HOME on Linux, then ~/.cache", () => {
    expect(
      resolveCacheDir({ env: { XDG_CACHE_HOME: "/xdg" }, platform: "linux", home: "/h" }),
    ).toBe("/xdg/inboard");
    expect(resolveCacheDir({ env: {}, platform: "linux", home: "/h" })).toBe("/h/.cache/inboard");
  });

  it("uses LOCALAPPDATA on Windows", () => {
    expect(
      resolveCacheDir({ env: { LOCALAPPDATA: "C:\\L" }, platform: "win32", home: "C:\\h" }),
    ).toBe(join("C:\\L", "inboard", "cache"));
  });
});

describe("resolveOffline", () => {
  it("is on when the option is true", () => {
    expect(resolveOffline(true, {})).toBe(true);
  });

  it("is turned on by INBOARD_OFFLINE=1 or true, even when the option is false", () => {
    expect(resolveOffline(undefined, { INBOARD_OFFLINE: "1" })).toBe(true);
    expect(resolveOffline(false, { INBOARD_OFFLINE: "true" })).toBe(true);
    expect(resolveOffline(undefined, { INBOARD_OFFLINE: "0" })).toBe(false);
    expect(resolveOffline(undefined, {})).toBe(false);
  });
});
