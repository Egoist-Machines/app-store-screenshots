/**
 * @typedef {{ path: string, rasterizeTo?: { width: number, height: number } }} ImagePreloadRequest
 */

/** @param {string | ImagePreloadRequest} request */
export function normalizeImagePreloadRequest(request) {
  if (typeof request === "string") return { path: request };
  return request;
}

/** @param {string} path @param {string} [mimeType] */
export function isSvgAsset(path, mimeType = "") {
  if (mimeType.toLowerCase().split(";", 1)[0].trim() === "image/svg+xml") return true;
  if (path.toLowerCase().startsWith("data:image/svg+xml")) return true;
  const withoutQuery = path.split(/[?#]/, 1)[0];
  return withoutQuery.toLowerCase().endsWith(".svg");
}

/** @param {string | ImagePreloadRequest} request */
export function imagePreloadKey(request) {
  const normalized = normalizeImagePreloadRequest(request);
  const target = normalized.rasterizeTo;
  return target
    ? `${normalized.path}|${target.width}x${target.height}`
    : normalized.path;
}
