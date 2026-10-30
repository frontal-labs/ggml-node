import { rm } from "node:fs/promises";
import { Argument, Command, CommanderError, Option } from "commander";
import {
  benchModel,
  doctor,
  doctorExitCode,
  runPrompt,
  type TinyLLMFactory,
} from "@/cli/commands.js";
import { isTinyLLMError, TinyLLMError } from "@/core/errors.js";
import { listOptionsSchema, pullOptionsSchema } from "@/core/schemas.js";
import { createTinyLLM } from "@/core/tiny-llm.js";
import { env as defaultEnv, type TinyLLMEnv } from "@/env.js";
import { resolveCacheDir, resolveOffline } from "@/registry/cache.js";
import { downloadFile, verifyFile } from "@/registry/download.js";
import { isModelPresent, modelFilePath } from "@/registry/ensure.js";
import { MODEL_IDS, MODELS, type ModelId } from "@/registry/models.js";
import { VERSION } from "@/version.js";

/** Exit codes from PLAN section 3.6. */
export const EXIT = { ENVIRONMENT_ERROR: 2, OK: 0, USER_ERROR: 1 } as const;

export interface CliIO {
  /** Builds the TinyLLM used by run, bench and doctor. Tests inject the mock; the default is the real one. */
  createTinyLLM?: TinyLLMFactory;
  env?: TinyLLMEnv;
  fetch?: typeof fetch;
  stderr: (text: string) => void;
  /** Whether stderr is a terminal. Progress lines are only drawn when it is. */
  stderrIsTTY?: boolean;
  stdout: (text: string) => void;
}

/** Runs one CLI command and returns its exit code. Never throws. */
export async function runCli(argv: readonly string[], io: CliIO): Promise<number> {
  const env = io.env ?? defaultEnv;
  const state: CommandState = { exitCode: EXIT.OK };
  const program = createProgram(io, env, state);
  try {
    await program.parseAsync([...argv], { from: "user" });
    return state.exitCode;
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help and --version exit 0. Usage errors exit 1.
      return err.exitCode === 0 ? EXIT.OK : EXIT.USER_ERROR;
    }
    return reportError(err, io);
  }
}

/** Builds the commander program. Exported so the help text can be tested. */
const MARKS = { fail: "FAIL", ok: "ok  ", warn: "warn" } as const;

/** Set by commands that need a non-zero exit without an error, such as `doctor` with a failed check. */
export interface CommandState {
  exitCode: number;
}

export function createProgram(
  io: CliIO,
  env: TinyLLMEnv = defaultEnv,
  state: CommandState = { exitCode: EXIT.OK },
): Command {
  const program = new Command()
    .name("tiny-llm")
    .description("Run a small LLM in-process. No daemon, no API key, no port.")
    .version(VERSION, "-v, --version")
    .exitOverride()
    .configureOutput({
      writeErr: (text) => io.stderr(text),
      writeOut: (text) => io.stdout(text),
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

  const factory: TinyLLMFactory = io.createTinyLLM ?? ((options) => createTinyLLM(options));

  program
    .command("run")
    .description("generate text for a prompt, or a structured object with --json-schema")
    .argument("<prompt>", "the prompt to send")
    .addOption(
      new Option("--model <modelId>", "registry model id")
        .choices(MODEL_IDS)
        .default("qwen2.5-0.5b"),
    )
    .option("--json-schema <file>", "JSON Schema file: print a validated object")
    .option("--json", "print the result and its metadata as JSON")
    .action(async (prompt: string, raw: { model: string; jsonSchema?: string; json?: boolean }) => {
      const output = await runPrompt(
        prompt,
        { json: raw.json ?? false, jsonSchema: raw.jsonSchema, model: raw.model },
        factory,
        env,
      );
      io.stdout(raw.json ? `${JSON.stringify(output, null, 2)}\n` : `${output.text}\n`);
    });

  program
    .command("bench")
    .description("measure load time, first token, tokens per second and peak memory")
    .addArgument(
      new Argument("[modelId]", "registry model id").choices(MODEL_IDS).default("qwen2.5-0.5b"),
    )
    .option("--tokens <n>", "tokens to generate", (value) => Number.parseInt(value, 10), 128)
    .option("--json", "machine-readable output")
    .action(async (modelId: ModelId, raw: { tokens: number; json?: boolean }) => {
      if (!Number.isInteger(raw.tokens) || raw.tokens < 1) {
        throw new TinyLLMError("INVALID_OPTIONS", "--tokens must be a whole number of at least 1", {
          hint: "Pass --tokens 128, for example.",
        });
      }
      const result = await benchModel(modelId, raw.tokens, factory, env);
      if (raw.json) {
        io.stdout(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }
      io.stdout(
        [
          `model            ${result.model}`,
          `load             ${result.loadMs.toFixed(0)} ms`,
          `first token      ${result.firstTokenMs.toFixed(0)} ms`,
          `tokens           ${result.tokens}`,
          `tokens/sec       ${result.tokensPerSecond.toFixed(1)}`,
          `peak RSS         ${(result.peakRssBytes / 1024 ** 2).toFixed(0)} MB`,
          `gpu              ${result.gpu}`,
          "",
        ].join("\n"),
      );
    });

  program
    .command("doctor")
    .description("check the platform, memory, cache, and that the backend loads")
    .option("--json", "machine-readable output")
    .action(async (raw: { json?: boolean }) => {
      const checks = await doctor(factory, env);
      if (raw.json) {
        io.stdout(`${JSON.stringify(checks, null, 2)}\n`);
      } else {
        for (const c of checks) {
          const mark = MARKS[c.status];
          io.stdout(`${mark}  ${c.name.padEnd(14)}${c.detail}\n`);
          if (c.fix && c.status !== "ok") {
            io.stdout(`      fix: ${c.fix}\n`);
          }
        }
      }
      state.exitCode = doctorExitCode(checks);
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
  if (isTinyLLMError(err)) {
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
  env: TinyLLMEnv,
): Promise<void> {
  const entry = MODELS[modelId];
  const cacheDir = dir ?? resolveCacheDir({ env });

  if (resolveOffline(undefined, env)) {
    throw new TinyLLMError("INVALID_OPTIONS", "pull needs the network, but offline mode is on", {
      hint: "Unset TINY_LLM_OFFLINE, then run pull again.",
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
    destPath: path,
    sha256: entry.sha256,
    sizeBytes: entry.sizeBytes,
    url: entry.url,
    ...(io.fetch ? { fetch: io.fetch } : {}),
    onProgress: (received, total) => {
      if (!drawProgress) {
        return;
      }
      const pct = total === 0 ? 0 : Math.floor((received / total) * 100);
      io.stderr(`\r  ${formatBytes(received)} / ${formatBytes(total)} (${pct}%)`);
    },
  });
  if (drawProgress) {
    io.stderr("\n");
  }
  io.stdout(`${path}\n`);
}

async function list(json: boolean, io: CliIO, env: TinyLLMEnv): Promise<void> {
  const dir = resolveCacheDir({ env });
  const rows = await Promise.all(
    MODEL_IDS.map(async (id) => {
      const entry = MODELS[id];
      return {
        cached: await isModelPresent(entry, dir),
        contextLength: entry.contextLength,
        displayName: entry.displayName,
        id,
        license: entry.license,
        licenseUrl: entry.licenseUrl,
        path: modelFilePath(entry, dir),
        sizeBytes: entry.sizeBytes,
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

async function clearCache(modelId: ModelId | undefined, io: CliIO, env: TinyLLMEnv): Promise<void> {
  const dir = resolveCacheDir({ env });
  const targets: readonly ModelId[] = modelId ? [modelId] : MODEL_IDS;
  // Only the registry's own file names are touched, along with their partial and lock files.
  await Promise.all(
    targets.map(async (id) => {
      const path = modelFilePath(MODELS[id], dir);
      await Promise.all(
        [path, `${path}.partial`, `${path}.lock`].map((file) => rm(file, { force: true })),
      );
      io.stdout(`cleared ${id}\n`);
    }),
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) {
    return `${(bytes / 1e9).toFixed(2)} GB`;
  }
  if (bytes >= 1e6) {
    return `${(bytes / 1e6).toFixed(1)} MB`;
  }
  if (bytes >= 1e3) {
    return `${(bytes / 1e3).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}
