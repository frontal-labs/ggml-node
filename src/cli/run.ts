import { rm } from "node:fs/promises";
import { InboardError, isInboardError } from "../core/errors.js";
import { resolveCacheDir, resolveOffline } from "../registry/cache.js";
import { downloadFile, verifyFile } from "../registry/download.js";
import { isModelPresent, modelFilePath } from "../registry/ensure.js";
import { MODEL_IDS, MODELS, type ModelId } from "../registry/models.js";

/** Exit codes from PLAN section 3.6. */
export const EXIT = { OK: 0, USER_ERROR: 1, ENVIRONMENT_ERROR: 2 } as const;

export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
  /** Whether stderr is a terminal. Progress lines are only drawn when it is. */
  stderrIsTTY?: boolean;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

const USAGE = `Usage:
  inboard pull <modelId> [--dir <path>]
  inboard list [--json]
  inboard cache path
  inboard cache clear [<modelId>]

Models: ${MODEL_IDS.join(", ")}`;

class UsageError extends Error {}

/** Runs one CLI command and returns its exit code. Never throws. */
export async function runCli(argv: readonly string[], io: CliIO): Promise<number> {
  const env = io.env ?? process.env;
  try {
    const [command, ...rest] = argv;
    switch (command) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.stdout(`${USAGE}\n`);
        return EXIT.OK;
      case "pull":
        return await pull(rest, io, env);
      case "list":
        return await list(rest, io, env);
      case "cache":
        return await cache(rest, io, env);
      default:
        throw new UsageError(`Unknown command "${command}"`);
    }
  } catch (err) {
    return reportError(err, io);
  }
}

function reportError(err: unknown, io: CliIO): number {
  if (err instanceof UsageError) {
    io.stderr(`error: ${err.message}\n\n${USAGE}\n`);
    return EXIT.USER_ERROR;
  }
  if (isInboardError(err)) {
    io.stderr(`error [${err.code}]: ${err.message}\n  hint: ${err.hint}\n`);
    return err.code === "INVALID_OPTIONS" || err.code === "MODEL_NOT_FOUND"
      ? EXIT.USER_ERROR
      : EXIT.ENVIRONMENT_ERROR;
  }
  const message = err instanceof Error ? err.message : String(err);
  io.stderr(`error: ${message}\n`);
  return EXIT.ENVIRONMENT_ERROR;
}

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | true>;
}

const VALUE_FLAGS = new Set(["--dir"]);
const BOOLEAN_FLAGS = new Set(["--json"]);

function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (BOOLEAN_FLAGS.has(name)) {
      flags.set(name, true);
    } else if (VALUE_FLAGS.has(name)) {
      const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
      if (!value || value.startsWith("--")) throw new UsageError(`${name} needs a value`);
      flags.set(name, value);
    } else {
      throw new UsageError(`Unknown option "${name}"`);
    }
  }
  return { positionals, flags };
}

function requireModelId(raw: string | undefined): ModelId {
  if (!raw) throw new UsageError("Missing <modelId>");
  if (!(MODEL_IDS as readonly string[]).includes(raw)) {
    throw new InboardError("INVALID_OPTIONS", `Unknown model "${raw}"`, {
      hint: `Choose one of: ${MODEL_IDS.join(", ")}. Run "npx inboard list" for details.`,
    });
  }
  return raw as ModelId;
}

async function pull(args: string[], io: CliIO, env: NodeJS.ProcessEnv): Promise<number> {
  const { positionals, flags } = parseArgs(args);
  if (positionals.length > 1) throw new UsageError("pull takes one <modelId>");
  const id = requireModelId(positionals[0]);
  const entry = MODELS[id];
  const dirFlag = flags.get("--dir");
  const dir = typeof dirFlag === "string" ? dirFlag : resolveCacheDir({ env });

  if (resolveOffline(undefined, env)) {
    throw new InboardError("INVALID_OPTIONS", "pull needs the network, but offline mode is on", {
      hint: "Unset INBOARD_OFFLINE, then run pull again.",
    });
  }

  const path = modelFilePath(entry, dir);
  if (await isModelPresent(entry, dir)) {
    if (await verifyFile(path, entry.sha256)) {
      io.stdout(`${id} is already downloaded and verified: ${path}\n`);
      return EXIT.OK;
    }
    io.stderr(`${id} is present but fails its checksum. Downloading it again.\n`);
    await rm(path, { force: true });
  }

  io.stderr(
    `Downloading ${entry.displayName} (${formatBytes(entry.sizeBytes)}) from Hugging Face\n`,
  );
  const drawProgress = io.stderrIsTTY === true;
  await downloadFile({
    url: entry.url,
    sha256: entry.sha256,
    sizeBytes: entry.sizeBytes,
    destPath: path,
    fetch: io.fetch,
    onProgress: (received, total) => {
      if (!drawProgress) return;
      const pct = total === 0 ? 0 : Math.floor((received / total) * 100);
      io.stderr(`\r  ${formatBytes(received)} / ${formatBytes(total)} (${pct}%)`);
    },
  });
  if (drawProgress) io.stderr("\n");
  io.stdout(`${path}\n`);
  return EXIT.OK;
}

async function list(args: string[], io: CliIO, env: NodeJS.ProcessEnv): Promise<number> {
  const { positionals, flags } = parseArgs(args);
  if (positionals.length > 0) throw new UsageError("list takes no arguments");
  const dir = resolveCacheDir({ env });

  const rows = await Promise.all(
    MODEL_IDS.map(async (id) => {
      const entry = MODELS[id];
      return {
        id,
        displayName: entry.displayName,
        sizeBytes: entry.sizeBytes,
        contextLength: entry.contextLength,
        license: entry.license,
        licenseUrl: entry.licenseUrl,
        cached: await isModelPresent(entry, dir),
        path: modelFilePath(entry, dir),
      };
    }),
  );

  if (flags.has("--json")) {
    io.stdout(`${JSON.stringify(rows, null, 2)}\n`);
    return EXIT.OK;
  }
  io.stdout(
    `${"ID".padEnd(14)}${"SIZE".padEnd(10)}${"LICENSE".padEnd(14)}${"CACHED".padEnd(8)}NAME\n`,
  );
  for (const row of rows) {
    io.stdout(
      `${row.id.padEnd(14)}${formatBytes(row.sizeBytes).padEnd(10)}${row.license.padEnd(14)}${(row.cached ? "yes" : "no").padEnd(8)}${row.displayName}\n`,
    );
  }
  io.stdout(`\nCache dir: ${dir}\n`);
  return EXIT.OK;
}

async function cache(args: string[], io: CliIO, env: NodeJS.ProcessEnv): Promise<number> {
  const [sub, ...rest] = args;
  const dir = resolveCacheDir({ env });

  if (sub === "path") {
    if (rest.length > 0) throw new UsageError("cache path takes no arguments");
    io.stdout(`${dir}\n`);
    return EXIT.OK;
  }
  if (sub === "clear") {
    const targets: readonly ModelId[] = rest.length > 0 ? [requireModelId(rest[0])] : MODEL_IDS;
    if (rest.length > 1) throw new UsageError("cache clear takes at most one <modelId>");
    for (const id of targets) {
      const path = modelFilePath(MODELS[id], dir);
      // Only the registry's own file names are touched, along with their partial and lock files.
      for (const file of [path, `${path}.partial`, `${path}.lock`]) {
        await rm(file, { force: true });
      }
      io.stdout(`cleared ${id}\n`);
    }
    return EXIT.OK;
  }
  throw new UsageError('cache needs "path" or "clear"');
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}
