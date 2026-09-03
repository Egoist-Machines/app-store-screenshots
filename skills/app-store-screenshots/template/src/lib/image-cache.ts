"use client";
// Pre-loads images as base64 data URIs so html-to-image exports without
// non-deterministic image fetch races. Always use img(path) in render.

import {
  imagePreloadKey,
  isSvgAsset,
  normalizeImagePreloadRequest,
} from "./image-preflight.mjs";

export type ImagePreloadRequest = {
  path: string;
  rasterizeTo?: { width: number; height: number };
};

const cache = new Map<string, { dataUrl: string; preloadKey: string }>();
const failed = new Set<string>();
const inflight = new Map<string, Promise<string | null>>();
const desired = new Map<string, string>();

async function fetchAsDataUrl(request: ImagePreloadRequest): Promise<string | null> {
  try {
    const resp = await fetch(request.path);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (isSvgAsset(request.path, blob.type)) {
      return await rasterizeSvg(blob, request.rasterizeTo);
    }
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

export async function preloadImages(
  requests: Array<string | ImagePreloadRequest>,
  options: { retryFailed?: boolean } = {},
): Promise<void> {
  await Promise.all(
    requests
      .map(normalizeImagePreloadRequest)
      .filter((request) => request.path)
      .filter((request) => {
        const cached = cache.get(request.path);
        return (
          cached?.preloadKey !== imagePreloadKey(request) &&
          (options.retryFailed || !failed.has(request.path))
        );
      })
      .map(async (request) => {
        const key = imagePreloadKey(request);
        desired.set(request.path, key);
        let pending = inflight.get(key);
        if (!pending) {
          pending = fetchAsDataUrl(request);
          inflight.set(key, pending);
        }
        const data = await pending.finally(() => inflight.delete(key));
        if (data && desired.get(request.path) === key) {
          cache.set(request.path, { dataUrl: data, preloadKey: key });
          failed.delete(request.path);
        } else if (!data && desired.get(request.path) === key) {
          failed.add(request.path);
        }
      }),
  );
}

export function img(path: string | undefined): string {
  if (!path) return "";
  const cached = cache.get(path);
  if (cached) return cached.dataUrl;
  if (path.startsWith("data:")) return path;
  if (failed.has(path)) return "";
  return path;
}

export function setImage(path: string, dataUrl: string) {
  cache.set(path, { dataUrl, preloadKey: path });
  failed.delete(path);
}

export function didFail(path: string | undefined): boolean {
  if (!path) return false;
  if (path.startsWith("data:")) return false;
  return failed.has(path);
}

async function rasterizeSvg(
  blob: Blob,
  target: ImagePreloadRequest["rasterizeTo"],
): Promise<string> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();

    const width = positiveDimension(target?.width) ?? positiveDimension(image.naturalWidth);
    const height = positiveDimension(target?.height) ?? positiveDimension(image.naturalHeight);
    if (!width || !height) throw new Error("SVG has no rasterizable dimensions");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas unavailable");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);

    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (output) => (output ? resolve(output) : reject(new Error("SVG rasterization failed"))),
        "image/png",
      );
    });
    return await blobToDataUrl(png);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function positiveDimension(value: number | undefined): number | undefined {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.round(value!) : undefined;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
