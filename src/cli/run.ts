import { rm } from "node:fs/promises";
import { Argument, Command, CommanderError, Option } from "commander";
import { InboardError, isInboardError } from "@/core/errors.js";
import { listOptionsSchema, pullOptionsSchema } from "@/core/schemas.js";
import { env as defaultEnv, type InboardEnv } from "@/env.js";
import { resolveCacheDir, resolveOffline } from "@/registry/cache.js";
import { downloadFile, verifyFile } from "@/registry/download.js";
import { isModelPresent, modelFilePath } from "@/registry/ensure.js";
import { MODEL_IDS, MODELS, type ModelId } from "@/registry/models.js";
import { VERSION } from "@/version.js";

/** Exit codes from PLAN section 3.6. */
export const EXIT = { OK: 0, USER_ERROR: 1, ENVIRONMENT_ERROR: 2 } as const;

export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
  /** Whether stderr is a terminal. Progress lines are only drawn when it is. */
  stderrIsTTY?: boolean;
  env?: InboardEnv;
  fetch?: typeof fetch;
}

/** Runs one CLI command and returns its exit code. Never throws. */
export async function runCli(argv: readonly string[], io: CliIO): Promise<number> {
  const env = io.env ?? defaultEnv;
  const program = createProgram(io, env);
  try {
    await program.parseAsync([...argv], { from: "user" });
    return EXIT.OK;
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help and --version exit 0. Usage errors exit 1.
      return err.exitCode === 0 ? EXIT.OK : EXIT.USER_ERROR;
    }
    return reportError(err, io);
  }
}

/** Builds the commander program. Exported so the help text can be tested. */
export function createProgram(io: CliIO, env: InboardEnv = defaultEnv): Command {
  const program = new Command()
    .name("inboard")
    .description("Run a small LLM in-process. No daemon, no API key, no port.")
    .version(VERSION, "-v, --version")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.stdout(text),
      writeErr: (text) => io.stderr(text),
    });

  const modelArgument = new Argument("<modelId>", "registry model id").choices(MODEL_IDS);

  program
    .command("pull")
    .description("download a registry model and verify its SHA-256")
    .addArgument(modelArgument)
    .option("--dir <path>", "cache directory to download into")
    .action(async (modelId: ModelId, raw: { dir?: string }) => {
      const options = pullOptionsSchema.parse(raw);
      await pull(modelId, options.dir, io, env);
    });

  program
    .command("list")
    .description("list registry models, their cache state, size and license")
    .addOption(new Option("--json", "machine-readable output"))
    .action(async (raw: { json?: boolean }) => {
      const options = listOptionsSchema.parse({ json: raw.json ?? false });
      await list(options.json, io, env);
    });

  const cache = program.command("cache").description("inspect or clear the model cache");
  cache
    .command("path")
    .description("print the cache directory")
    .action(() => {
      io.stdout(`${resolveCacheDir({ env })}\n`);
    });
  cache
    .command("clear")
    .description("delete cached model files, or only the one given")
    .addArgument(new Argument("[modelId]", "registry model id").choices(MODEL_IDS))
    .action(async (modelId?: ModelId) => {
      await clearCache(modelId, io, env);
    });

  return program;
}

function reportError(err: unknown, io: CliIO): number {
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

async function pull(
  modelId: ModelId,
  dir: string | undefined,
  io: CliIO,
  env: InboardEnv,
): Promise<void> {
  const entry = MODELS[modelId];
  const cacheDir = dir ?? resolveCacheDir({ env });

  if (resolveOffline(undefined, env)) {
    throw new InboardError("INVALID_OPTIONS", "pull needs the network, but offline mode is on", {
      hint: "Unset INBOARD_OFFLINE, then run pull again.",
    });
  }

  const path = modelFilePath(entry, cacheDir);
  if (await isModelPresent(entry, cacheDir)) {
    if (await verifyFile(path, entry.sha256)) {
      io.stdout(`${modelId} is already downloaded and verified: ${path}\n`);
      return;
    }
    io.stderr(`${modelId} is present but fails its checksum. Downloading it again.\n`);
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
    ...(io.fetch ? { fetch: io.fetch } : {}),
    onProgress: (received, total) => {
      if (!drawProgress) return;
      const pct = total === 0 ? 0 : Math.floor((received / total) * 100);
      io.stderr(`\r  ${formatBytes(received)} / ${formatBytes(total)} (${pct}%)`);
    },
  });
  if (drawProgress) io.stderr("\n");
  io.stdout(`${path}\n`);
}

async function list(json: boolean, io: CliIO, env: InboardEnv): Promise<void> {
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

  if (json) {
    io.stdout(`${JSON.stringify(rows, null, 2)}\n`);
    return;
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
}

async function clearCache(modelId: ModelId | undefined, io: CliIO, env: InboardEnv): Promise<void> {
  const dir = resolveCacheDir({ env });
  const targets: readonly ModelId[] = modelId ? [modelId] : MODEL_IDS;
  for (const id of targets) {
    const path = modelFilePath(MODELS[id], dir);
    // Only the registry's own file names are touched, along with their partial and lock files.
    for (const file of [path, `${path}.partial`, `${path}.lock`]) {
      await rm(file, { force: true });
    }
    io.stdout(`cleared ${id}\n`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${bytes} B`;
}
