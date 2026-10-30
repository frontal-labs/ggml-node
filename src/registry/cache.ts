import { homedir } from "node:os";
import { join } from "node:path";

export interface ResolveCacheDirOptions {
  /** Explicit option. Wins over the environment. */
  cacheDir?: string | undefined;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
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
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();

  if (options.cacheDir) return options.cacheDir;
  if (env.INBOARD_CACHE_DIR) return env.INBOARD_CACHE_DIR;

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
 * Offline is on when the option is `true`, or when `INBOARD_OFFLINE` is `1` or `true`.
 * The env var can turn offline on, but an explicit `offline: false` does not turn it off.
 */
export function resolveOffline(
  option: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (option === true) return true;
  const raw = env.INBOARD_OFFLINE;
  return raw === "1" || raw === "true";
}
