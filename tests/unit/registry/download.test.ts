import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isInboardError } from "@/core/errors.js";
import { downloadFile, verifyFile } from "@/registry/download.js";
import {
  type FixtureOptions,
  type FixtureServer,
  startFixtureServer,
} from "../../helpers/fixture-server.js";

const sha = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

describe("downloadFile", () => {
  let dir: string;
  let server: FixtureServer | undefined;
  let body: Buffer;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "inboard-dl-"));
    body = randomBytes(256 * 1024);
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    await rm(dir, { force: true, recursive: true });
  });

  async function serve(options: FixtureOptions = {}) {
    server = await startFixtureServer(body, options);
    return server;
  }

  it("downloads, verifies the SHA-256, and renames into place", async () => {
    const s = await serve();
    const progress: number[] = [];
    const dest = join(dir, "model.gguf");

    const result = await downloadFile({
      destPath: dest,
      onProgress: (received) => progress.push(received),
      sha256: sha(body),
      sizeBytes: body.length,
      url: s.url,
    });

    expect(result).toBe(dest);
    expect(Buffer.compare(await readFile(dest), body)).toBe(0);
    expect(progress.at(-1)).toBe(body.length);
    await expect(stat(`${dest}.partial`)).rejects.toThrow();
    await expect(stat(`${dest}.lock`)).rejects.toThrow();
    expect(s.requests).toEqual([undefined]);
  });

  it("deletes the download and throws CHECKSUM_MISMATCH when the hash is wrong", async () => {
    const s = await serve();
    const dest = join(dir, "model.gguf");
    const wrong = sha(Buffer.from("not the model"));

    const err = await downloadFile({
      destPath: dest,
      sha256: wrong,
      sizeBytes: body.length,
      url: s.url,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(isInboardError(err)).toBe(true);
    if (!isInboardError(err)) {
      throw new Error("unreachable");
    }
    expect(err.code).toBe("CHECKSUM_MISMATCH");
    expect(err.hint).not.toBe("");
    await expect(stat(dest)).rejects.toThrow();
    await expect(stat(`${dest}.partial`)).rejects.toThrow();
  });

  it("resumes an interrupted download with a Range request", async () => {
    const s = await serve();
    const dest = join(dir, "model.gguf");
    const cut = 100_000;
    // The first attempt streams `cut` bytes and then fails, like a dropped connection.
    // The retry uses the real server, so the Range request is still checked end to end.
    let attempts = 0;
    const flakyFetch: typeof fetch = async (input, init) => {
      attempts += 1;
      const real = await fetch(input, init);
      if (attempts > 1 || !real.body) {
        return real;
      }
      const reader = real.body.getReader();
      let sent = 0;
      const truncated = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { value, done } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          const room = cut - sent;
          if (room <= 0) {
            controller.error(new Error("connection reset"));
            return;
          }
          const piece = value.subarray(0, room);
          sent += piece.byteLength;
          controller.enqueue(piece);
        },
      });
      return new Response(truncated, { headers: real.headers, status: real.status });
    };
    const request = {
      destPath: dest,
      fetch: flakyFetch,
      sha256: sha(body),
      sizeBytes: body.length,
      url: s.url,
    };

    const first = await downloadFile(request).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isInboardError(first) && first.code).toBe("DOWNLOAD_FAILED");
    const kept = (await stat(`${dest}.partial`)).size;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(body.length);

    await downloadFile(request);
    expect(s.requests[1]).toBe(`bytes=${kept}-`);
    expect(Buffer.compare(await readFile(dest), body)).toBe(0);
  });

  it("rewrites the file when the server ignores Range and sends the whole body", async () => {
    const s = await serve({ ignoreRange: true });
    const dest = join(dir, "model.gguf");
    await writeFile(`${dest}.partial`, body.subarray(0, 50_000));

    await downloadFile({ destPath: dest, sha256: sha(body), sizeBytes: body.length, url: s.url });

    expect(s.requests[0]).toBe("bytes=50000-");
    expect(Buffer.compare(await readFile(dest), body)).toBe(0);
  });

  it("discards a partial file that is larger than the expected size", async () => {
    const s = await serve();
    const dest = join(dir, "model.gguf");
    await writeFile(`${dest}.partial`, Buffer.alloc(body.length + 10, 1));

    await downloadFile({ destPath: dest, sha256: sha(body), sizeBytes: body.length, url: s.url });

    expect(Buffer.compare(await readFile(dest), body)).toBe(0);
    expect(s.requests).toEqual([undefined]);
  });

  it("runs one download for concurrent callers in the same process", async () => {
    const s = await serve();
    const dest = join(dir, "model.gguf");
    const request = { destPath: dest, sha256: sha(body), sizeBytes: body.length, url: s.url };

    const results = await Promise.all([1, 2, 3, 4, 5].map(() => downloadFile(request)));

    expect(new Set(results)).toEqual(new Set([dest]));
    expect(s.requests).toHaveLength(1);
  });

  it("waits for a lock held by a live process, then reuses the finished file", async () => {
    const s = await serve();
    const dest = join(dir, "model.gguf");
    // process.pid is alive, so this lock is not stale. Another "process" is downloading.
    await writeFile(`${dest}.lock`, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    setTimeout(() => {
      writeFile(dest, body).catch(() => undefined);
    }, 400);

    const result = await downloadFile({
      destPath: dest,
      sha256: sha(body),
      sizeBytes: body.length,
      url: s.url,
    });

    expect(result).toBe(dest);
    expect(s.requests).toHaveLength(0);
    await rm(`${dest}.lock`, { force: true });
  });

  it("removes a stale lock left by a dead process", async () => {
    const s = await serve();
    const dest = join(dir, "model.gguf");
    // PID 2^22 is above the default kernel PID limit on macOS and Linux, so it cannot be alive.
    await writeFile(`${dest}.lock`, JSON.stringify({ pid: 4_194_304, startedAt: 0 }));

    await downloadFile({ destPath: dest, sha256: sha(body), sizeBytes: body.length, url: s.url });

    expect(Buffer.compare(await readFile(dest), body)).toBe(0);
    await expect(stat(`${dest}.lock`)).rejects.toThrow();
  });

  it("aborts with ABORTED and keeps the partial file for a later resume", async () => {
    const s = await serve({ stallAfter: 64 * 1024 });
    const dest = join(dir, "model.gguf");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);

    const err = await downloadFile({
      destPath: dest,
      sha256: sha(body),
      signal: controller.signal,
      sizeBytes: body.length,
      url: s.url,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(isInboardError(err) && err.code).toBe("ABORTED");
    expect((await stat(`${dest}.partial`)).size).toBeGreaterThan(0);
  });

  it("throws DOWNLOAD_FAILED with a hint when the host cannot be reached", async () => {
    const s = await serve();
    await s.close();
    server = undefined;
    const dest = join(dir, "model.gguf");

    const err = await downloadFile({
      destPath: dest,
      sha256: sha(body),
      sizeBytes: body.length,
      url: s.url,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(isInboardError(err) && err.code).toBe("DOWNLOAD_FAILED");
    expect(isInboardError(err) && err.hint.length > 0).toBe(true);
  });
});

describe("verifyFile", () => {
  it("returns true only when the content hash matches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inboard-verify-"));
    try {
      const path = join(dir, "f.bin");
      const data = Buffer.from("hello inboard");
      await writeFile(path, data);
      expect(await verifyFile(path, sha(data))).toBe(true);
      expect(await verifyFile(path, sha(Buffer.from("other")))).toBe(false);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
