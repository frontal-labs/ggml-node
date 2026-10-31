import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIO, EXIT, runCli } from "@/cli/run.js";
import { createMockGgmlNode } from "@/testing/index.js";

interface Captured {
  err: string;
  io: CliIO;
  out: string;
}

function capture(extra: Partial<CliIO> = {}): Captured {
  const c = { err: "", out: "" } as Captured;
  c.io = {
    stderr: (t) => {
      c.err += t;
    },
    stdout: (t) => {
      c.out += t;
    },
    ...extra,
  };
  return c;
}

describe("ggml-node run", () => {
  it("prints the generated text using the injected backend", async () => {
    const c = capture({
      createGgmlNode: () => createMockGgmlNode({ respond: "a short answer" }),
    });
    expect(await runCli(["run", "what is a river?"], c.io)).toBe(EXIT.OK);
    expect(c.out).toBe("a short answer\n");
  });

  it("prints a JSON result with usage and timing with --json", async () => {
    const c = capture({ createGgmlNode: () => createMockGgmlNode({ respond: "one two" }) });
    expect(await runCli(["run", "x", "--json"], c.io)).toBe(EXIT.OK);
    const parsed = JSON.parse(c.out) as {
      text: string;
      finishReason: string;
      usage: { outputTokens: number };
    };
    expect(parsed.text).toBe("one two");
    expect(parsed.finishReason).toBe("stop");
    expect(parsed.usage.outputTokens).toBe(2);
  });

  it("validates the object against a JSON Schema file with --json-schema", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ggml-node-run-"));
    try {
      const schemaPath = join(dir, "schema.json");
      await writeFile(
        schemaPath,
        JSON.stringify({ properties: { n: { type: "integer" } }, type: "object" }),
      );
      const c = capture({ createGgmlNode: () => createMockGgmlNode({ respond: '{"n":7}' }) });
      expect(await runCli(["run", "count", "--json-schema", schemaPath], c.io)).toBe(EXIT.OK);
      expect(c.out.trim()).toBe('{"n":7}');
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("rejects an unknown model id before loading anything", async () => {
    const c = capture({ createGgmlNode: () => createMockGgmlNode() });
    expect(await runCli(["run", "x", "--model", "gpt-4o"], c.io)).toBe(EXIT.USER_ERROR);
  });
});

describe("ggml-node bench", () => {
  it("reports the measurements as JSON with the expected fields", async () => {
    const c = capture({
      createGgmlNode: () => createMockGgmlNode({ respond: "one two three four" }),
    });
    expect(await runCli(["bench", "qwen2.5-0.5b", "--tokens", "4", "--json"], c.io)).toBe(EXIT.OK);
    const result = JSON.parse(c.out) as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(
      [
        "firstTokenMs",
        "gpu",
        "loadMs",
        "model",
        "peakRssBytes",
        "tokens",
        "tokensPerSecond",
        "totalMs",
      ].sort(),
    );
    expect(result.model).toBe("qwen2.5-0.5b");
    expect(result.tokens).toBe(4);
  });

  it("prints a readable table by default", async () => {
    const c = capture({ createGgmlNode: () => createMockGgmlNode({ respond: "a b" }) });
    expect(await runCli(["bench", "--tokens", "2"], c.io)).toBe(EXIT.OK);
    expect(c.out).toContain("tokens/sec");
    expect(c.out).toContain("peak RSS");
  });

  it("rejects a non-positive --tokens value with a hint", async () => {
    const c = capture({ createGgmlNode: () => createMockGgmlNode() });
    expect(await runCli(["bench", "--tokens", "0"], c.io)).toBe(EXIT.USER_ERROR);
    expect(c.err).toContain("--tokens must be a whole number");
  });
});

describe("ggml-node doctor", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ggml-node-doc-"));
  });
  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("checks the platform, memory and cache, and warns when the default model is missing", async () => {
    const c = capture({ createGgmlNode: () => createMockGgmlNode() });
    const code = await runCli(["doctor", "--json"], { ...c.io, env: { GGML_NODE_CACHE_DIR: dir } });
    const checks = JSON.parse(c.out) as { name: string; status: string; fix?: string }[];
    const names = checks.map((x) => x.name);
    expect(names).toEqual(
      expect.arrayContaining(["platform", "cpu", "memory", "cache dir", "default model"]),
    );
    const model = checks.find((x) => x.name === "default model");
    expect(model?.status).toBe("warn");
    expect(model?.fix).toContain("npx ggml-node pull qwen2.5-0.5b");
    expect(code).toBe(EXIT.OK);
  });

  it("fails with exit 2 and a fix when the cache directory cannot be written", async () => {
    const blocker = join(dir, "file");
    await writeFile(blocker, "not a directory");
    const c = capture({ createGgmlNode: () => createMockGgmlNode() });
    const code = await runCli(["doctor", "--json"], {
      ...c.io,
      env: { GGML_NODE_CACHE_DIR: join(blocker, "cache") },
    });
    const checks = JSON.parse(c.out) as { name: string; status: string; fix?: string }[];
    expect(checks.find((x) => x.name === "cache dir")?.status).toBe("fail");
    expect(code).toBe(2);
  });

  it("prints a fix line under each problem in text mode", async () => {
    const c = capture({ createGgmlNode: () => createMockGgmlNode() });
    await runCli(["doctor"], { ...c.io, env: { GGML_NODE_CACHE_DIR: dir } });
    expect(c.out).toContain("fix: Run: npx ggml-node pull qwen2.5-0.5b");
  });
});

describe("help", () => {
  it("lists every command (snapshot)", async () => {
    const c = capture();
    await runCli(["--help"], c.io);
    expect(c.out).toMatchSnapshot();
  });
});
