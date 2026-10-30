import { stat } from "node:fs/promises";
import { join } from "node:path";
import { InboardError } from "../core/errors.js";
import type { InboardEvent } from "../core/types.js";
import { downloadFile } from "./download.js";
import { MODELS, type ModelId } from "./models.js";

/** Licenses that need no explicit acceptance. Anything else needs `acceptLicense: true`. */
const PERMISSIVE_LICENSES: ReadonlySet<string> = new Set(["Apache-2.0", "MIT"]);

/** The fields the downloader and license gate need from a registry entry. */
export interface DownloadableModel {
  id: ModelId;
  file: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  license: string;
  licenseUrl: string;
}

export interface EnsureModelOptions {
  cacheDir: string;
  /** False in offline mode, or when `autoDownload` is false. */
  allowDownload: boolean;
  /** Whether offline mode is what blocked the download. Only changes the hint. */
  offline: boolean;
  acceptLicense: boolean;
  signal?: AbortSignal | undefined;
  fetch?: typeof fetch | undefined;
  onEvent?: ((event: InboardEvent) => void) | undefined;
}

export function modelFilePath(model: Pick<DownloadableModel, "file">, cacheDir: string): string {
  return join(cacheDir, model.file);
}

/** True when the file exists with the expected size. The full hash is checked on download. */
export async function isModelPresent(model: DownloadableModel, cacheDir: string): Promise<boolean> {
  try {
    return (await stat(modelFilePath(model, cacheDir))).size === model.sizeBytes;
  } catch {
    return false;
  }
}

/** Ensures a registry model is in the cache and returns its path. */
export function ensureModel(id: ModelId, options: EnsureModelOptions): Promise<string> {
  return ensureEntry(MODELS[id], options);
}

/**
 * Ensures a model entry is in the cache. Checks the license gate first, then reuses the file if
 * it is present, then downloads if allowed. Otherwise throws `MODEL_NOT_FOUND`.
 */
export async function ensureEntry(
  model: DownloadableModel,
  options: EnsureModelOptions,
): Promise<string> {
  if (!PERMISSIVE_LICENSES.has(model.license) && !options.acceptLicense) {
    throw new InboardError(
      "LICENSE_NOT_ACCEPTED",
      `Model ${model.id} is licensed under ${model.license}`,
      {
        hint: `Read ${model.licenseUrl}, then pass acceptLicense: true to accept it.`,
      },
    );
  }

  const path = modelFilePath(model, options.cacheDir);
  if (await isModelPresent(model, options.cacheDir)) return path;

  if (!options.allowDownload) {
    throw new InboardError("MODEL_NOT_FOUND", `Model ${model.id} is not in the cache`, {
      hint: options.offline
        ? `Offline mode is on. Run "npx inboard pull ${model.id}" while online, or copy the file to ${options.cacheDir}.`
        : `Run: npx inboard pull ${model.id}`,
    });
  }

  options.onEvent?.({ type: "download:start", model: model.id, totalBytes: model.sizeBytes });
  await downloadFile({
    url: model.url,
    sha256: model.sha256,
    sizeBytes: model.sizeBytes,
    destPath: path,
    signal: options.signal,
    fetch: options.fetch,
    onProgress: (receivedBytes, totalBytes) => {
      options.onEvent?.({ type: "download:progress", model: model.id, receivedBytes, totalBytes });
    },
  });
  options.onEvent?.({ type: "download:done", model: model.id, path });
  return path;
}
