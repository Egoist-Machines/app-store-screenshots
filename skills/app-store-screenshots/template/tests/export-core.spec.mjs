import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import test from "node:test";
import JSZip from "jszip";

import {
  addStableZipEntries,
  buildExportPath,
  encodeOpaquePng,
  panoramaGeometry,
  sortExportEntries,
  STABLE_ZIP_DATE,
} from "../src/lib/export-core.mjs";
import {
  imagePreloadKey,
  isSvgAsset,
} from "../src/lib/image-preflight.mjs";

test("panorama geometry retains the declared artwork width in a partial window", () => {
  assert.deepEqual(panoramaGeometry(1320, 3, 4, 8, 8), {
    artworkPanels: 8,
    left: -5280,
    width: 10560,
  });
  assert.deepEqual(panoramaGeometry(1320, 3, 1, undefined, 8), {
    artworkPanels: 8,
    left: -1320,
    width: 10560,
  });
});

test("complex SVG assets receive a stable full-size raster preflight key", async () => {
  const fixture = await readFile(new URL("./fixtures/complex-panorama.svg", import.meta.url), "utf8");
  assert.match(fixture, /<pattern/);
  assert.match(fixture, /<symbol/);
  assert.match(fixture, /<use/);
  assert.equal(isSvgAsset("/campaign/journey.svg?v=3"), true);
  assert.equal(isSvgAsset("/asset?id=journey", "image/svg+xml; charset=utf-8"), true);
  assert.equal(isSvgAsset("/campaign/journey.png", "image/png"), false);
  assert.equal(
    imagePreloadKey({
      path: "/campaign/journey.svg?v=3",
      rasterizeTo: { width: 10560, height: 2868 },
    }),
    "/campaign/journey.svg?v=3|10560x2868",
  );
});

test("export paths and archive entries sort by resolution, locale, and screen", () => {
  const paths = [
    buildExportPath({
      platform: "ios",
      device: "iphone",
      width: 1320,
      height: 2868,
      locale: "en",
      index: 7,
      layout: "device-bottom",
    }),
    buildExportPath({
      platform: "ios",
      device: "iphone",
      width: 1125,
      height: 2436,
      locale: "en",
      index: 1,
      layout: "hero",
    }),
    buildExportPath({
      platform: "ios",
      device: "iphone",
      width: 1320,
      height: 2868,
      locale: "en",
      index: 0,
      layout: "hero",
    }),
  ];
  const sorted = sortExportEntries(paths.map((path) => ({ path, data: path })));
  assert.deepEqual(sorted.map((entry) => entry.path), [
    "ios/iphone/1125x2436/en/02-hero.png",
    "ios/iphone/1320x2868/en/01-hero.png",
    "ios/iphone/1320x2868/en/08-device-bottom.png",
  ]);
  assert.deepEqual(
    [
      STABLE_ZIP_DATE.getFullYear(),
      STABLE_ZIP_DATE.getMonth(),
      STABLE_ZIP_DATE.getDate(),
      STABLE_ZIP_DATE.getHours(),
      STABLE_ZIP_DATE.getMinutes(),
      STABLE_ZIP_DATE.getSeconds(),
    ],
    [1980, 0, 1, 0, 0, 0],
  );
});

test("archive bytes and central-directory order are stable", async () => {
  const entries = [
    { path: "ios/iphone/1320x2868/en/08-device-bottom.png", data: new Uint8Array([8]) },
    { path: "ios/iphone/1320x2868/en/01-hero.png", data: new Uint8Array([1]) },
    { path: "ios/iphone/1125x2436/en/01-hero.png", data: new Uint8Array([2]) },
  ];
  const first = await stableArchive(entries);
  const second = await stableArchive(entries);
  assert.deepEqual(first, second);

  const parsed = await JSZip.loadAsync(first);
  assert.deepEqual(Object.keys(parsed.files), [
    "ios/iphone/1125x2436/en/01-hero.png",
    "ios/iphone/1320x2868/en/01-hero.png",
    "ios/iphone/1320x2868/en/08-device-bottom.png",
  ]);
});

test("opaque PNG encoding is deterministic and uses RGB color type", async () => {
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 0,
    0, 255, 0, 64,
    0, 0, 255, 128,
    240, 230, 220, 255,
  ]);
  const first = await encodeOpaquePng(2, 2, rgba);
  const second = await encodeOpaquePng(2, 2, rgba);
  assert.deepEqual(first, second);

  const parsed = parsePng(first);
  assert.equal(parsed.width, 2);
  assert.equal(parsed.height, 2);
  assert.equal(parsed.bitDepth, 8);
  assert.equal(parsed.colorType, 2);
  assert.deepEqual(unfilterRgb(parsed.width, parsed.height, parsed.scanlines), [
    255, 0, 0,
    0, 255, 0,
    0, 0, 255,
    240, 230, 220,
  ]);
});

function parsePng(png) {
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  const idat = [];
  while (offset < png.length) {
    const length = readUint32(png, offset);
    const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += length + 12;
  }
  return {
    width,
    height,
    bitDepth,
    colorType,
    scanlines: new Uint8Array(inflateSync(Buffer.concat(idat.map((value) => Buffer.from(value))))),
  };
}

function unfilterRgb(width, height, scanlines) {
  const stride = width * 3;
  const output = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = scanlines[rowStart];
    for (let i = 0; i < stride; i += 1) {
      const encoded = scanlines[rowStart + 1 + i];
      const outputIndex = y * stride + i;
      const left = i >= 3 ? output[outputIndex - 3] : 0;
      const up = y > 0 ? output[outputIndex - stride] : 0;
      const upLeft = y > 0 && i >= 3 ? output[outputIndex - stride - 3] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upLeft);
      output[outputIndex] = (encoded + predictor) & 0xff;
    }
  }
  return Array.from(output);
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

function readUint32(bytes, offset) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  ) >>> 0;
}

async function stableArchive(entries) {
  const zip = new JSZip();
  addStableZipEntries(entries, (entry, date) => {
    zip.file(entry.path, entry.data, {
      binary: true,
      createFolders: false,
      date,
    });
  });
  return zip.generateAsync({ type: "uint8array", compression: "STORE", platform: "UNIX" });
}
