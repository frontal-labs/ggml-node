import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isNodeSlmError } from "@/core/errors.js";
import type { NodeSlmEvent } from "@/core/types.js";
import { ensureEntry, ensureModel } from "@/registry/ensure.js";
import { MODELS, type ModelId } from "@/registry/models.js";
import { type FixtureServer, startFixtureServer } from "../../helpers/fixture-server.js";

describe("ensureModel and ensureEntry", () => {
  let dir: string;
  let server: FixtureServer | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "node-slm-ensure-"));
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    await rm(dir, { force: true, recursive: true });
    vi.restoreAllMocks();
  });

  it("refuses to download in offline mode and says how to fix it", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network must not be used");
    });

    const err = await ensureModel("qwen2.5-0.5b", {
      acceptLicense: false,
      allowDownload: false,
      cacheDir: dir,
      fetch: fetchSpy as unknown as typeof fetch,
      offline: true,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(isNodeSlmError(err) && err.code).toBe("MODEL_NOT_FOUND");
    expect(isNodeSlmError(err) && err.hint).toContain("Offline mode is on");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("points to pull when autoDownload is off and the model is missing", async () => {
    const err = await ensureModel("qwen2.5-0.5b", {
      acceptLicense: false,
      allowDownload: false,
      cacheDir: dir,
      offline: false,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(isNodeSlmError(err) && err.code).toBe("MODEL_NOT_FOUND");
    expect(isNodeSlmError(err) && err.hint).toBe("Run: npx node-slm pull qwen2.5-0.5b");
  });

  it("returns the existing file without any network call when its size matches", async () => {
    const entry = MODELS["qwen2.5-0.5b"];
    const path = join(dir, entry.file);
    await writeFile(path, Buffer.alloc(entry.sizeBytes));
    const fetchSpy = vi.fn();

    const result = await ensureModel("qwen2.5-0.5b", {
      acceptLicense: false,
      allowDownload: true,
      cacheDir: dir,
      fetch: fetchSpy as unknown as typeof fetch,
      offline: false,
    });

    expect(result).toBe(path);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks non-permissive licenses unless acceptLicense is set", async () => {
    const body = randomBytes(4096);
    server = await startFixtureServer(body);
    const entry = {
      ...MODELS["qwen2.5-0.5b"],
      file: "gated.gguf",
      license: "llama3.2",
      licenseUrl: "https://example.test/LICENSE",
      sha256: createHash("sha256").update(body).digest("hex"),
      sizeBytes: body.length,
      url: server.url,
    };

    const err = await ensureEntry(entry, {
      acceptLicense: false,
      allowDownload: true,
      cacheDir: dir,
      offline: false,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isNodeSlmError(err) && err.code).toBe("LICENSE_NOT_ACCEPTED");
    expect(isNodeSlmError(err) && err.hint).toContain("https://example.test/LICENSE");
    expect(server.requests).toHaveLength(0);

    const path = await ensureEntry(entry, {
      acceptLicense: true,
      allowDownload: true,
      cacheDir: dir,
      offline: false,
    });
    expect(path).toBe(join(dir, "gated.gguf"));
  });

  it("emits download:start, progress and done events in order", async () => {
    const body = randomBytes(8192);
    server = await startFixtureServer(body);
    const events: NodeSlmEvent[] = [];
    const entry = {
      file: "events.gguf",
      id: "qwen2.5-0.5b" as ModelId,
      license: "Apache-2.0",
      licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
      sha256: createHash("sha256").update(body).digest("hex"),
      sizeBytes: body.length,
      url: server.url,
    };

    await ensureEntry(entry, {
      acceptLicense: false,
      allowDownload: true,
      cacheDir: dir,
      offline: false,
      onEvent: (e) => events.push(e),
    });

    expect(events[0]).toEqual({
      model: "qwen2.5-0.5b",
      totalBytes: body.length,
      type: "download:start",
    });
    expect(events.at(-1)).toEqual({
      model: "qwen2.5-0.5b",
      path: join(dir, "events.gguf"),
      type: "download:done",
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
        file: "stale.gguf",
        id: "smollm2-360m",
        license: "Apache-2.0",
        licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
        sha256: createHash("sha256").update(body).digest("hex"),
        sizeBytes: body.length,
        url: server.url,
      },
      { acceptLicense: false, allowDownload: true, cacheDir: dir, offline: false },
    );

    expect(Buffer.compare(await readFile(dest), body)).toBe(0);
  });
});
