import { homedir } from "node:os";
import { join } from "node:path";
import { LocalLLMError } from "@/core/errors.js";
import { env as defaultEnv, flagSchema, type LocalLLMEnv } from "@/env.js";

export interface ResolveCacheDirOptions {
  /** Explicit option. Wins over the environment. */
  cacheDir?: string | undefined;
  env?: LocalLLMEnv;
  home?: string;
  platform?: NodeJS.Platform;
}

/**
 * Resolves the model cache directory.
 *
 * Order: `cacheDir` option, then `LOCAL_LLM_CACHE_DIR`, then the OS cache directory:
 * - macOS: `~/Library/Caches/local-llm`
 * - Linux: `$XDG_CACHE_HOME/local-llm`, or `~/.cache/local-llm`
 * - Windows: `%LOCALAPPDATA%\local-llm\cache`
 */
export function resolveCacheDir(options: ResolveCacheDirOptions = {}): string {
  const env = options.env ?? defaultEnv;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();

  if (options.cacheDir) {
    return options.cacheDir;
  }
  if (env.LOCAL_LLM_CACHE_DIR) {
    return env.LOCAL_LLM_CACHE_DIR;
  }

  if (platform === "darwin") {
    return join(home, "Library", "Caches", "local-llm");
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return join(localAppData, "local-llm", "cache");
  }
  const xdg = env.XDG_CACHE_HOME;
  return xdg ? join(xdg, "local-llm") : join(home, ".cache", "local-llm");
}

/**
 * Offline is on when the option is `true`, or when `LOCAL_LLM_OFFLINE` parses as true. The env var
 * can turn offline on, but an explicit `offline: false` does not turn it off. A value that is not a
 * boolean throws `INVALID_OPTIONS`, so a typo cannot silently leave the network on.
 */
export function resolveOffline(
  option: boolean | undefined,
  env: LocalLLMEnv = defaultEnv,
): boolean {
  if (option === true) {
    return true;
  }
  const raw = env.LOCAL_LLM_OFFLINE;
  if (raw === undefined) {
    return false;
  }
  const parsed = flagSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LocalLLMError(
      "INVALID_OPTIONS",
      `LOCAL_LLM_OFFLINE must be a boolean, got "${raw}"`,
      {
        hint: "Use 1 or 0, true or false.",
      },
    );
  }
  return parsed.data;
}
