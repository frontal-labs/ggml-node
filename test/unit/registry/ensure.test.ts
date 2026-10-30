import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isInboardError } from "../../../src/core/errors.js";
import type { InboardEvent } from "../../../src/core/types.js";
import { ensureEntry, ensureModel } from "../../../src/registry/ensure.js";
import { MODELS, type ModelId } from "../../../src/registry/models.js";
import { type FixtureServer, startFixtureServer } from "../../helpers/fixture-server.js";

describe("ensureModel and ensureEntry", () => {
  let dir: string;
  let server: FixtureServer | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "inboard-ensure-"));
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("refuses to download in offline mode and says how to fix it", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network must not be used");
    });

    const err = await ensureModel("qwen2.5-0.5b", {
      cacheDir: dir,
      allowDownload: false,
      offline: true,
      acceptLicense: false,
      fetch: fetchSpy as unknown as typeof fetch,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(isInboardError(err) && err.code).toBe("MODEL_NOT_FOUND");
    expect(isInboardError(err) && err.hint).toContain("Offline mode is on");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("points to pull when autoDownload is off and the model is missing", async () => {
    const err = await ensureModel("qwen2.5-0.5b", {
      cacheDir: dir,
      allowDownload: false,
      offline: false,
      acceptLicense: false,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(isInboardError(err) && err.code).toBe("MODEL_NOT_FOUND");
    expect(isInboardError(err) && err.hint).toBe("Run: npx inboard pull qwen2.5-0.5b");
  });

  it("returns the existing file without any network call when its size matches", async () => {
    const entry = MODELS["qwen2.5-0.5b"];
    const path = join(dir, entry.file);
    await writeFile(path, Buffer.alloc(entry.sizeBytes));
    const fetchSpy = vi.fn();

    const result = await ensureModel("qwen2.5-0.5b", {
      cacheDir: dir,
      allowDownload: true,
      offline: false,
      acceptLicense: false,
      fetch: fetchSpy as unknown as typeof fetch,
    });

    expect(result).toBe(path);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks non-permissive licenses unless acceptLicense is set", async () => {
    const body = randomBytes(4096);
    server = await startFixtureServer(body);
    const entry = {
      ...MODELS["qwen2.5-0.5b"],
      license: "llama3.2",
      licenseUrl: "https://example.test/LICENSE",
      url: server.url,
      sha256: createHash("sha256").update(body).digest("hex"),
      sizeBytes: body.length,
      file: "gated.gguf",
    };

    const err = await ensureEntry(entry, {
      cacheDir: dir,
      allowDownload: true,
      offline: false,
      acceptLicense: false,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isInboardError(err) && err.code).toBe("LICENSE_NOT_ACCEPTED");
    expect(isInboardError(err) && err.hint).toContain("https://example.test/LICENSE");
    expect(server.requests).toHaveLength(0);

    const path = await ensureEntry(entry, {
      cacheDir: dir,
      allowDownload: true,
      offline: false,
      acceptLicense: true,
    });
    expect(path).toBe(join(dir, "gated.gguf"));
  });

  it("emits download:start, progress and done events in order", async () => {
    const body = randomBytes(8192);
    server = await startFixtureServer(body);
    const events: InboardEvent[] = [];
    const entry = {
      id: "qwen2.5-0.5b" as ModelId,
      file: "events.gguf",
      url: server.url,
      sha256: createHash("sha256").update(body).digest("hex"),
      sizeBytes: body.length,
      license: "Apache-2.0",
      licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
    };

    await ensureEntry(entry, {
      cacheDir: dir,
      allowDownload: true,
      offline: false,
      acceptLicense: false,
      onEvent: (e) => events.push(e),
    });

    expect(events[0]).toEqual({
      type: "download:start",
      model: "qwen2.5-0.5b",
      totalBytes: body.length,
    });
    expect(events.at(-1)).toEqual({
      type: "download:done",
      model: "qwen2.5-0.5b",
      path: join(dir, "events.gguf"),
    });
    expect(events.some((e) => e.type === "download:progress")).toBe(true);
  });

  it("writes a file of the wrong size into the cache and downloads over it", async () => {
    const body = randomBytes(2048);
    server = await startFixtureServer(body);
    const dest = join(dir, "stale.gguf");
    await writeFile(dest, Buffer.from("junk"));

    await ensureEntry(
      {
        id: "smollm2-360m",
        file: "stale.gguf",
        url: server.url,
        sha256: createHash("sha256").update(body).digest("hex"),
        sizeBytes: body.length,
        license: "Apache-2.0",
        licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
      },
      { cacheDir: dir, allowDownload: true, offline: false, acceptLicense: false },
    );

    expect(Buffer.compare(await readFile(dest), body)).toBe(0);
  });
});
