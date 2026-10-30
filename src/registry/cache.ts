import { homedir } from "node:os";
import { join } from "node:path";
import { InboardError } from "@/core/errors.js";
import { env as defaultEnv, flagSchema, type InboardEnv } from "@/env.js";

export interface ResolveCacheDirOptions {
  /** Explicit option. Wins over the environment. */
  cacheDir?: string | undefined;
  env?: InboardEnv;
  home?: string;
  platform?: NodeJS.Platform;
}

/**
 * Resolves the model cache directory.
 *
 * Order: `cacheDir` option, then `INBOARD_CACHE_DIR`, then the OS cache directory:
 * - macOS: `~/Library/Caches/inboard`
 * - Linux: `$XDG_CACHE_HOME/inboard`, or `~/.cache/inboard`
 * - Windows: `%LOCALAPPDATA%\inboard\cache`
 */
export function resolveCacheDir(options: ResolveCacheDirOptions = {}): string {
  const env = options.env ?? defaultEnv;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();

  if (options.cacheDir) {
    return options.cacheDir;
  }
  if (env.INBOARD_CACHE_DIR) {
    return env.INBOARD_CACHE_DIR;
  }

  if (platform === "darwin") {
    return join(home, "Library", "Caches", "inboard");
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return join(localAppData, "inboard", "cache");
  }
  const xdg = env.XDG_CACHE_HOME;
  return xdg ? join(xdg, "inboard") : join(home, ".cache", "inboard");
}

/**
 * Offline is on when the option is `true`, or when `INBOARD_OFFLINE` parses as true. The env var
 * can turn offline on, but an explicit `offline: false` does not turn it off. A value that is not a
 * boolean throws `INVALID_OPTIONS`, so a typo cannot silently leave the network on.
 */
export function resolveOffline(option: boolean | undefined, env: InboardEnv = defaultEnv): boolean {
  if (option === true) {
    return true;
  }
  const raw = env.INBOARD_OFFLINE;
  if (raw === undefined) {
    return false;
  }
  const parsed = flagSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InboardError("INVALID_OPTIONS", `INBOARD_OFFLINE must be a boolean, got "${raw}"`, {
      hint: "Use 1 or 0, true or false.",
    });
  }
  return parsed.data;
}
