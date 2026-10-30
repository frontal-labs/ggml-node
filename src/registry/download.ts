import { createHash, type Hash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { InboardError } from "../core/errors.js";

export interface DownloadOptions {
  url: string;
  /** Expected lowercase hex SHA-256 of the complete file. */
  sha256: string;
  /** Expected size of the complete file in bytes. */
  sizeBytes: number;
  /** Final path. The download is written to `${destPath}.partial` first. */
  destPath: string;
  signal?: AbortSignal | undefined;
  /** Defaults to the global `fetch`. Injected by tests. */
  fetch?: typeof fetch | undefined;
  onProgress?: ((receivedBytes: number, totalBytes: number) => void) | undefined;
}

const PROGRESS_INTERVAL_MS = 100;
const LOCK_POLL_MS = 250;
const HALF_WRITTEN_LOCK_GRACE_MS = 10_000;

/** In-process dedupe: concurrent callers for the same destination share one download. */
const inflight = new Map<string, Promise<string>>();

/**
 * Downloads a file with resume, verifies its SHA-256 and size, then renames it into place.
 *
 * - Streams to `${destPath}.partial`. Re-running resumes with an HTTP Range request.
 * - Hashes while streaming. A mismatch deletes the partial file and throws `CHECKSUM_MISMATCH`.
 * - One download per destination: concurrent calls in this process share one promise, and a
 *   `.lock` file stops other processes from downloading the same file at the same time.
 */
export function downloadFile(options: DownloadOptions): Promise<string> {
  const key = resolve(options.destPath);
  const running = inflight.get(key);
  if (running) return running;

  const task = runExclusive(options).finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

/** Streams a file through SHA-256 and reports whether it matches `sha256`. */
export async function verifyFile(path: string, sha256: string): Promise<boolean> {
  const hash = createHash("sha256");
  await hashFileInto(path, hash);
  return hash.digest("hex") === sha256;
}

async function runExclusive(options: DownloadOptions): Promise<string> {
  const { destPath, sizeBytes } = options;
  await mkdir(dirname(destPath), { recursive: true });

  const lock = await acquireLock(destPath, sizeBytes);
  if (lock === "already-downloaded") return destPath;

  try {
    await fetchAndVerify(options);
    await rename(`${destPath}.partial`, destPath);
    return destPath;
  } finally {
    await lock.release();
  }
}

async function fetchAndVerify(options: DownloadOptions): Promise<void> {
  const { url, sha256, sizeBytes, destPath, signal, onProgress } = options;
  const partial = `${destPath}.partial`;
  const fetchFn = options.fetch ?? fetch;

  let offset = await sizeOf(partial);
  if (offset > sizeBytes) {
    await rm(partial, { force: true });
    offset = 0;
  }

  let hash: Hash;
  if (offset < sizeBytes) {
    const result = await streamInto({
      fetchFn,
      url,
      partial,
      offset,
      sizeBytes,
      signal,
      onProgress,
    });
    offset = result.received;
    hash = result.hash;
  } else {
    // The partial file is already the full size. Hash it and let verification decide.
    hash = createHash("sha256");
    await hashFileInto(partial, hash);
  }

  if (offset !== sizeBytes) {
    throw new InboardError(
      "DOWNLOAD_FAILED",
      `Download incomplete: ${offset} of ${sizeBytes} bytes`,
      {
        hint: "Run the same command again. The partial file is kept, so the download resumes.",
      },
    );
  }

  if (hash.digest("hex") !== sha256) {
    await rm(partial, { force: true });
    throw new InboardError("CHECKSUM_MISMATCH", `SHA-256 mismatch for ${destPath}`, {
      hint: "The partial file was deleted. Run the command again. If this keeps happening, the registry entry may be wrong: report it.",
    });
  }
}

interface StreamArgs {
  fetchFn: typeof fetch;
  url: string;
  partial: string;
  offset: number;
  sizeBytes: number;
  signal: AbortSignal | undefined;
  onProgress: ((receivedBytes: number, totalBytes: number) => void) | undefined;
}

interface StreamResult {
  received: number;
  /** Hash over every byte in the partial file, including bytes from earlier attempts. */
  hash: Hash;
}

/**
 * Streams the response body into the partial file, starting at `offset`.
 *
 * - `206` on a resumed request: the existing bytes are hashed first, then new bytes are appended.
 * - `200` on a resumed request: the server ignored Range, so the file is rewritten from zero.
 * - `416` on a resumed request: the partial file is stale, so it is discarded and fetched again.
 */
async function streamInto(args: StreamArgs): Promise<StreamResult> {
  const { fetchFn, url, partial, sizeBytes, signal, onProgress } = args;
  const headers: Record<string, string> = args.offset > 0 ? { Range: `bytes=${args.offset}-` } : {};
  const response = await request(fetchFn, url, headers, signal);

  if (response.status === 416 && args.offset > 0) {
    await rm(partial, { force: true });
    return streamInto({ ...args, offset: 0 });
  }
  if (!response.ok || !response.body) {
    throw new InboardError("DOWNLOAD_FAILED", `HTTP ${response.status} while downloading ${url}`, {
      hint: "Check the network connection, and that the model URL in the registry still resolves.",
    });
  }

  let offset = args.offset;
  const hash = createHash("sha256");
  if (offset > 0 && response.status === 206) {
    await hashFileInto(partial, hash);
  } else {
    await rm(partial, { force: true });
    offset = 0;
  }

  const handle = await open(partial, offset > 0 ? "a" : "w");
  let received = offset;
  let lastReport = 0;
  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      await handle.write(chunk);
      received += chunk.byteLength;
      const now = Date.now();
      if (onProgress && now - lastReport >= PROGRESS_INTERVAL_MS) {
        lastReport = now;
        onProgress(received, sizeBytes);
      }
    }
  } catch (err) {
    await handle.close();
    if (signal?.aborted) {
      throw new InboardError("ABORTED", "Download was aborted", {
        hint: "Run the same command again to resume.",
        cause: err,
      });
    }
    throw new InboardError("DOWNLOAD_FAILED", `Connection lost while downloading ${url}`, {
      hint: "Run the same command again. The partial file is kept, so the download resumes.",
      cause: err,
    });
  }
  await handle.close();
  onProgress?.(received, sizeBytes);
  return { received, hash };
}

async function request(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<Response> {
  try {
    return await fetchFn(url, { headers, redirect: "follow", ...(signal ? { signal } : {}) });
  } catch (err) {
    if (signal?.aborted) {
      throw new InboardError("ABORTED", "Download was aborted", {
        hint: "Run the same command again to resume.",
        cause: err,
      });
    }
    throw new InboardError("DOWNLOAD_FAILED", `Could not reach ${url}`, {
      hint: "Check the network connection. For an air-gapped machine, pull the model elsewhere and copy it into the cache dir.",
      cause: err,
    });
  }
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function hashFileInto(path: string, hash: Hash): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise());
  });
}

interface Lock {
  release(): Promise<void>;
}

/**
 * Takes the `.lock` file for a destination. If another live process holds it, waits for that
 * process. Returns `"already-downloaded"` when the other process finished the file meanwhile.
 */
async function acquireLock(
  destPath: string,
  sizeBytes: number,
): Promise<Lock | "already-downloaded"> {
  const lockPath = `${destPath}.lock`;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      await handle.close();
      return { release: () => rm(lockPath, { force: true }) };
    } catch (err) {
      if (!isErrno(err, "EEXIST")) throw err;
    }

    if (await isStaleLock(lockPath)) {
      await rm(lockPath, { force: true });
      continue;
    }

    if ((await sizeOf(destPath)) === sizeBytes) return "already-downloaded";
    await sleep(LOCK_POLL_MS);
  }
}

async function isStaleLock(lockPath: string): Promise<boolean> {
  let pid: number;
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: unknown };
    if (typeof parsed.pid !== "number") return true;
    pid = parsed.pid;
  } catch {
    // Unreadable or half-written. Treat it as stale only once it has existed for a while.
    return ageMs(lockPath).then(
      (age) => age > HALF_WRITTEN_LOCK_GRACE_MS,
      () => true,
    );
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    // EPERM means the process exists under another user, so the lock is not stale.
    return !isErrno(err, "EPERM");
  }
}

async function ageMs(path: string): Promise<number> {
  return Date.now() - (await stat(path)).mtimeMs;
}

function isErrno(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === code;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
