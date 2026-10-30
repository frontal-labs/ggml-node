import { homedir } from "node:os";
import { join } from "node:path";
import { TinyLLMError } from "@/core/errors.js";
import { env as defaultEnv, flagSchema, type TinyLLMEnv } from "@/env.js";

export interface ResolveCacheDirOptions {
  /** Explicit option. Wins over the environment. */
  cacheDir?: string | undefined;
  env?: TinyLLMEnv;
  home?: string;
  platform?: NodeJS.Platform;
}

/**
 * Resolves the model cache directory.
 *
 * Order: `cacheDir` option, then `TINY_LLM_CACHE_DIR`, then the OS cache directory:
 * - macOS: `~/Library/Caches/tiny-llm`
 * - Linux: `$XDG_CACHE_HOME/tiny-llm`, or `~/.cache/tiny-llm`
 * - Windows: `%LOCALAPPDATA%\tiny-llm\cache`
 */
export function resolveCacheDir(options: ResolveCacheDirOptions = {}): string {
  const env = options.env ?? defaultEnv;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();

  if (options.cacheDir) {
    return options.cacheDir;
  }
  if (env.TINY_LLM_CACHE_DIR) {
    return env.TINY_LLM_CACHE_DIR;
  }

  if (platform === "darwin") {
    return join(home, "Library", "Caches", "tiny-llm");
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return join(localAppData, "tiny-llm", "cache");
  }
  const xdg = env.XDG_CACHE_HOME;
  return xdg ? join(xdg, "tiny-llm") : join(home, ".cache", "tiny-llm");
}

/**
 * Offline is on when the option is `true`, or when `TINY_LLM_OFFLINE` parses as true. The env var
 * can turn offline on, but an explicit `offline: false` does not turn it off. A value that is not a
 * boolean throws `INVALID_OPTIONS`, so a typo cannot silently leave the network on.
 */
export function resolveOffline(option: boolean | undefined, env: TinyLLMEnv = defaultEnv): boolean {
  if (option === true) {
    return true;
  }
  const raw = env.TINY_LLM_OFFLINE;
  if (raw === undefined) {
    return false;
  }
  const parsed = flagSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TinyLLMError("INVALID_OPTIONS", `TINY_LLM_OFFLINE must be a boolean, got "${raw}"`, {
      hint: "Use 1 or 0, true or false.",
    });
  }
  return parsed.data;
}
