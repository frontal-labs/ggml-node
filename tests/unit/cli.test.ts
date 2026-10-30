import { mkdtemp, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIO, EXIT, runCli } from "@/cli/run.js";
import { MODELS } from "@/registry/models.js";

interface Captured {
  err: string;
  io: CliIO;
  out: string;
}

function capture(env: NodeJS.ProcessEnv): Captured {
  const captured = { err: "", out: "" } as Captured;
  captured.io = {
    env,
    stderr: (t) => {
      captured.err += t;
    },
    stdout: (t) => {
      captured.out += t;
    },
  };
  return captured;
}

describe("inboard CLI", () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "inboard-cli-"));
  });

  afterEach(async () => {
    await rm(cacheDir, { force: true, recursive: true });
  });

  const env = () => ({ INBOARD_CACHE_DIR: cacheDir }) as NodeJS.ProcessEnv;

  it("prints usage for help and exits 0", async () => {
    const c = capture(env());
    expect(await runCli(["help"], c.io)).toBe(EXIT.OK);
    expect(c.out).toContain("pull");
  });

  it("exits 1 for an unknown command", async () => {
    const c = capture(env());
    expect(await runCli(["frobnicate"], c.io)).toBe(EXIT.USER_ERROR);
    expect(c.err).toContain("unknown command 'frobnicate'");
  });

  it("exits 1 with an actionable hint for an unknown model id", async () => {
    const c = capture(env());
    expect(await runCli(["pull", "gpt-4o"], c.io)).toBe(EXIT.USER_ERROR);
    expect(c.err).toContain("Allowed choices");
    expect(c.err).toContain("qwen2.5-0.5b");
  });

  it("refuses pull in offline mode with exit 1", async () => {
    const c = capture({ ...env(), INBOARD_OFFLINE: "1" });
    expect(await runCli(["pull", "qwen2.5-0.5b"], c.io)).toBe(EXIT.USER_ERROR);
    expect(c.err).toContain("offline mode is on");
  });

  it("rejects unknown flags", async () => {
    const c = capture(env());
    expect(await runCli(["list", "--nope"], c.io)).toBe(EXIT.USER_ERROR);
    expect(c.err).toContain("unknown option '--nope'");
  });

  it("lists every registry model as not cached in an empty cache", async () => {
    const c = capture(env());
    expect(await runCli(["list", "--json"], c.io)).toBe(EXIT.OK);
    const rows = JSON.parse(c.out) as { id: string; cached: boolean }[];
    expect(rows.map((r) => r.id)).toEqual(Object.keys(MODELS));
    expect(rows.every((r) => r.cached === false)).toBe(true);
  });

  it("marks a model as cached when its file is present at the registry size", async () => {
    const entry = MODELS["qwen2.5-0.5b"];
    // A sparse file: it reports the right size without writing the bytes to disk.
    await writeFile(join(cacheDir, entry.file), "");
    await truncate(join(cacheDir, entry.file), entry.sizeBytes);
    expect((await stat(join(cacheDir, entry.file))).size).toBe(entry.sizeBytes);

    const c = capture(env());
    expect(await runCli(["list", "--json"], c.io)).toBe(EXIT.OK);
    const row = (JSON.parse(c.out) as { id: string; cached: boolean }[]).find(
      (r) => r.id === "qwen2.5-0.5b",
    );
    expect(row?.cached).toBe(true);
  });

  it("prints the cache directory", async () => {
    const c = capture(env());
    expect(await runCli(["cache", "path"], c.io)).toBe(EXIT.OK);
    expect(c.out.trim()).toBe(cacheDir);
  });

  it("clears only the requested model's files", async () => {
    const q = MODELS["qwen2.5-0.5b"];
    const s = MODELS["smollm2-360m"];
    await writeFile(join(cacheDir, q.file), "0123456789");
    await writeFile(join(cacheDir, s.file), "0123456789");

    const c = capture(env());
    expect(await runCli(["cache", "clear", "qwen2.5-0.5b"], c.io)).toBe(EXIT.OK);

    await expect(stat(join(cacheDir, q.file))).rejects.toThrow();
    expect((await stat(join(cacheDir, s.file))).size).toBe(10);
  });

  it("exits 1 for a bad cache subcommand", async () => {
    const c = capture(env());
    expect(await runCli(["cache", "explode"], c.io)).toBe(EXIT.USER_ERROR);
  });
});
