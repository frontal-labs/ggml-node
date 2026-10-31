import { homedir } from "node:os";
import { join } from "node:path";
import { GgmlNodeError } from "@/core/errors.js";
import { env as defaultEnv, flagSchema, type GgmlNodeEnv } from "@/env.js";

export interface ResolveCacheDirOptions {
  /** Explicit option. Wins over the environment. */
  cacheDir?: string | undefined;
  env?: GgmlNodeEnv;
  home?: string;
  platform?: NodeJS.Platform;
}

/**
 * Resolves the model cache directory.
 *
 * Order: `cacheDir` option, then `GGML_NODE_CACHE_DIR`, then the OS cache directory:
 * - macOS: `~/Library/Caches/ggml-node`
 * - Linux: `$XDG_CACHE_HOME/ggml-node`, or `~/.cache/ggml-node`
 * - Windows: `%LOCALAPPDATA%\ggml-node\cache`
 */
export function resolveCacheDir(options: ResolveCacheDirOptions = {}): string {
  const env = options.env ?? defaultEnv;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();

  if (options.cacheDir) {
    return options.cacheDir;
  }
  if (env.GGML_NODE_CACHE_DIR) {
    return env.GGML_NODE_CACHE_DIR;
  }

  if (platform === "darwin") {
    return join(home, "Library", "Caches", "ggml-node");
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return join(localAppData, "ggml-node", "cache");
  }
  const xdg = env.XDG_CACHE_HOME;
  return xdg ? join(xdg, "ggml-node") : join(home, ".cache", "ggml-node");
}

/**
 * Offline is on when the option is `true`, or when `GGML_NODE_OFFLINE` parses as true. The env var
 * can turn offline on, but an explicit `offline: false` does not turn it off. A value that is not a
 * boolean throws `INVALID_OPTIONS`, so a typo cannot silently leave the network on.
 */
export function resolveOffline(
  option: boolean | undefined,
  env: GgmlNodeEnv = defaultEnv,
): boolean {
  if (option === true) {
    return true;
  }
  const raw = env.GGML_NODE_OFFLINE;
  if (raw === undefined) {
    return false;
  }
  const parsed = flagSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GgmlNodeError(
      "INVALID_OPTIONS",
      `GGML_NODE_OFFLINE must be a boolean, got "${raw}"`,
      {
        hint: "Use 1 or 0, true or false.",
      },
    );
  }
  return parsed.data;
}
