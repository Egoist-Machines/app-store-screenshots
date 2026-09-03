const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
/** A fixed ZIP timestamp keeps otherwise identical archives reproducible. */
export const STABLE_ZIP_DATE = new Date(1980, 0, 1, 0, 0, 0, 0);

/**
 * Return geometry for one panorama that may be rendered through a smaller
 * preview or export window.
 *
 * @param {number} canvasWidth
 * @param {number} renderedScreenCount
 * @param {number} startPanel
 * @param {number | undefined} declaredPanels
 * @param {number | undefined} totalPanels
 */
export function panoramaGeometry(
  canvasWidth,
  renderedScreenCount,
  startPanel = 0,
  declaredPanels,
  totalPanels,
) {
  const fallbackPanels = positiveInteger(totalPanels) ?? positiveInteger(renderedScreenCount) ?? 1;
  const artworkPanels = positiveInteger(declaredPanels) ?? fallbackPanels;
  return {
    artworkPanels,
    left: -Math.max(0, Math.floor(startPanel)) * canvasWidth,
    width: artworkPanels * canvasWidth,
  };
}

/**
 * @param {{ platform: string, device: string, width: number, height: number, locale: string, index: number, layout: string }} input
 */
export function buildExportPath(input) {
  const filename = `${String(input.index + 1).padStart(2, "0")}-${input.layout}.png`;
  return `${input.platform}/${input.device}/${input.width}x${input.height}/${input.locale}/${filename}`;
}

/**
 * @template T
 * @param {Array<{ path: string, data: T }>} entries
 * @returns {Array<{ path: string, data: T }>}
 */
export function sortExportEntries(entries) {
  return [...entries].sort((left, right) => {
    if (left.path < right.path) return -1;
    if (left.path > right.path) return 1;
    return 0;
  });
}

/**
 * Add entries to a JSZip-compatible archive with stable order and metadata.
 *
 * @template T
 * @param {Array<{ path: string, data: T }>} entries
 * @param {(entry: { path: string, data: T }, date: Date) => void} add
 */
export function addStableZipEntries(entries, add) {
  for (const entry of sortExportEntries(entries)) {
    add(entry, STABLE_ZIP_DATE);
  }
}

/**
 * Encode RGBA pixels as a PNG whose IHDR color type is RGB, not RGBA. The
 * caller should draw onto an opaque canvas first; alpha bytes are deliberately
 * omitted from the encoded image.
 *
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array | Uint8ClampedArray} rgba
 * @returns {Promise<Uint8Array>}
 */
export async function encodeOpaquePng(width, height, rgba) {
  if (!positiveInteger(width) || !positiveInteger(height)) {
    throw new TypeError("PNG dimensions must be positive integers");
  }
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new RangeError(`Expected ${expected} RGBA bytes, received ${rgba.length}`);
  }

  const scanlines = filterRgbScanlines(width, height, rgba);
  const compressed = await deflate(scanlines);
  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return concatBytes([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

/**
 * Draw a source image into an opaque target canvas, then encode it as RGB PNG.
 *
 * @param {CanvasImageSource} image
 * @param {number} sourceX
 * @param {number} sourceY
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @param {number} width
 * @param {number} height
 * @param {string} [backgroundColor]
 */
export async function renderOpaquePngSlice(
  image,
  sourceX,
  sourceY,
  sourceWidth,
  sourceHeight,
  width,
  height,
  backgroundColor = "#ffffff",
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("2D canvas unavailable");
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height,
  );
  return encodeOpaquePng(width, height, context.getImageData(0, 0, width, height).data);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function filterRgbScanlines(width, height, rgba) {
  const stride = width * 3;
  const output = new Uint8Array(height * (stride + 1));
  const current = new Uint8Array(stride);
  const previous = new Uint8Array(stride);
  const candidate = new Uint8Array(stride);
  const best = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const rgbaStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const input = rgbaStart + x * 4;
      const outputPixel = x * 3;
      current[outputPixel] = rgba[input];
      current[outputPixel + 1] = rgba[input + 1];
      current[outputPixel + 2] = rgba[input + 2];
    }

    let bestType = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let filterType = 0; filterType <= 4; filterType += 1) {
      let score = 0;
      for (let i = 0; i < stride; i += 1) {
        const left = i >= 3 ? current[i - 3] : 0;
        const up = previous[i];
        const upLeft = i >= 3 ? previous[i - 3] : 0;
        let predictor = 0;
        if (filterType === 1) predictor = left;
        else if (filterType === 2) predictor = up;
        else if (filterType === 3) predictor = Math.floor((left + up) / 2);
        else if (filterType === 4) predictor = paeth(left, up, upLeft);
        const value = (current[i] - predictor + 256) & 0xff;
        candidate[i] = value;
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = filterType;
        best.set(candidate);
      }
    }

    const rowStart = y * (stride + 1);
    output[rowStart] = bestType;
    output.set(best, rowStart + 1);
    previous.set(current);
  }
  return output;
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonalDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonalDistance) return left;
  if (upDistance <= diagonalDistance) return up;
  return upLeft;
}

async function deflate(bytes) {
  if (typeof CompressionStream !== "function") {
    throw new Error("This browser does not support deterministic PNG compression");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(concatBytes([typeBytes, data])));
  return chunk;
}

function concatBytes(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function writeUint32(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
