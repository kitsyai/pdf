import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef } from "pdf-lib";
import { loadPdf } from "../shared/files";

export type ImageInput =
  | { kind: "jpeg"; bytes: Uint8Array; width: number; height: number }
  | { kind: "raw"; pixels: Uint8Array; width: number; height: number; components: 1 | 3 };

export type CompressTarget = { maxDimension: number; quality: number };

/** Browser (canvas) or test implementation of the pixel work. */
export type ImageCodec = {
  inflate(bytes: Uint8Array): Promise<Uint8Array>;
  encodeJpeg(
    input: ImageInput,
    target: CompressTarget
  ): Promise<{ bytes: Uint8Array; width: number; height: number }>;
};

export const COMPRESSION_LEVELS: Record<string, CompressTarget & { label: string }> = {
  light: { label: "Light", maxDimension: 2400, quality: 0.82 },
  balanced: { label: "Balanced", maxDimension: 1600, quality: 0.7 },
  strong: { label: "Strong", maxDimension: 1100, quality: 0.55 },
};

const MIN_STREAM_BYTES = 8 * 1024;
const MAX_PIXELS = 40_000_000;
/** A re-encoded image must be at least this much smaller to replace the original. */
const MIN_SAVING = 0.9;

const N = (name: string) => PDFName.of(name);

function numberOf(dict: PDFDict, key: string, fallback?: number) {
  const value = dict.lookup(N(key));
  return value instanceof PDFNumber ? value.asNumber() : fallback;
}

function filterNames(dict: PDFDict) {
  const filter = dict.lookup(N("Filter"));
  if (filter instanceof PDFName) return [filter.decodeText()];
  if (filter instanceof PDFArray) {
    return filter.asArray().map((item) => (item instanceof PDFName ? item.decodeText() : "?"));
  }
  return [];
}

function decodeParms(dict: PDFDict) {
  const parms = dict.lookup(N("DecodeParms"));
  if (parms instanceof PDFDict) return parms;
  if (parms instanceof PDFArray && parms.size() === 1) {
    const first = parms.lookup(0);
    return first instanceof PDFDict ? first : null;
  }
  return null;
}

/** Number of colour components for colour spaces we can safely re-encode. */
export function colorComponents(dict: PDFDict): 1 | 3 | null {
  const space = dict.lookup(N("ColorSpace"));
  if (space === N("DeviceRGB")) return 3;
  if (space === N("DeviceGray")) return 1;
  if (space instanceof PDFArray && space.size() === 2 && space.lookup(0) === N("ICCBased")) {
    const profile = space.lookup(1);
    const count = profile instanceof PDFRawStream ? numberOf(profile.dict, "N") : undefined;
    if (count === 3) return 3;
    if (count === 1) return 1;
  }
  return null;
}

/** Reverse PNG row predictors (PDF /Predictor 10-15). */
export function unpredictPng(data: Uint8Array, columns: number, colors: number, bitsPerComponent = 8) {
  const bytesPerPixel = Math.max(1, Math.ceil((colors * bitsPerComponent) / 8));
  const rowLength = Math.ceil((columns * colors * bitsPerComponent) / 8);
  const rows = Math.floor(data.length / (rowLength + 1));
  const out = new Uint8Array(rows * rowLength);
  let previous = new Uint8Array(rowLength);

  for (let row = 0; row < rows; row += 1) {
    const filter = data[row * (rowLength + 1)];
    const input = data.subarray(row * (rowLength + 1) + 1, (row + 1) * (rowLength + 1));
    const current = out.subarray(row * rowLength, (row + 1) * rowLength);

    for (let i = 0; i < rowLength; i += 1) {
      const left = i >= bytesPerPixel ? current[i - bytesPerPixel] : 0;
      const up = previous[i];
      const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
      let value = input[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) {
        throw new Error(`Unknown PNG filter ${filter}.`);
      }
      current[i] = value & 0xff;
    }
    previous = current;
  }
  return out;
}

/** Refs used as another image's soft mask or stencil mask; never re-encode those. */
function collectMaskRefs(entries: Array<[PDFRef, unknown]>) {
  const masks = new Set<string>();
  for (const [, object] of entries) {
    if (!(object instanceof PDFRawStream)) continue;
    for (const key of ["SMask", "Mask"]) {
      const value = object.dict.get(N(key));
      if (value instanceof PDFRef) masks.add(value.toString());
    }
  }
  return masks;
}

export type CompressStats = {
  images: number;
  compressed: number;
  originalSize: number;
  newSize: number;
};

/**
 * Re-encode large embedded images as smaller JPEGs. Images that are masks,
 * use unusual colour spaces, or would not shrink are left untouched.
 */
export async function compressPdf(
  bytes: ArrayBuffer | Uint8Array,
  target: CompressTarget,
  codec: ImageCodec,
  onProgress?: (done: number, total: number) => void
) {
  const originalSize = bytes.byteLength;
  const doc = await loadPdf(bytes, { updateMetadata: false });
  const entries = doc.context.enumerateIndirectObjects();
  const masks = collectMaskRefs(entries);

  const candidates = entries.filter(
    ([, object]) =>
      object instanceof PDFRawStream && object.dict.lookup(N("Subtype")) === N("Image")
  ) as Array<[PDFRef, PDFRawStream]>;

  let compressed = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const [ref, stream] = candidates[index];
    onProgress?.(index, candidates.length);

    const input = await readImage(ref, stream, masks, codec);
    if (!input) continue;

    let encoded;
    try {
      encoded = await codec.encodeJpeg(input, target);
    } catch {
      continue;
    }
    if (encoded.bytes.length >= stream.contents.length * MIN_SAVING) continue;

    const dict = doc.context.obj({
      Type: "XObject",
      Subtype: "Image",
      Width: encoded.width,
      Height: encoded.height,
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
      Filter: "DCTDecode",
    }) as PDFDict;
    for (const key of ["SMask", "Interpolate", "Intent", "Metadata", "OC"]) {
      const value = stream.dict.get(N(key));
      if (value) dict.set(N(key), value);
    }
    doc.context.assign(ref, PDFRawStream.of(dict, encoded.bytes));
    compressed += 1;
  }
  onProgress?.(candidates.length, candidates.length);

  const out = await doc.save({ useObjectStreams: true });
  const stats: CompressStats = {
    images: candidates.length,
    compressed,
    originalSize,
    newSize: out.byteLength,
  };
  return { bytes: out, stats };
}

async function readImage(
  ref: PDFRef,
  stream: PDFRawStream,
  masks: Set<string>,
  codec: ImageCodec
): Promise<ImageInput | null> {
  const { dict } = stream;
  if (masks.has(ref.toString())) return null;
  if (stream.contents.length < MIN_STREAM_BYTES) return null;
  if (dict.lookup(N("ImageMask"))?.toString() === "true") return null;
  if (dict.get(N("Decode"))) return null;
  // Colour-key (array) and stencil (stream) masks: a colour key can't survive a
  // lossy JPEG, and the new dict doesn't carry /Mask, so transparency would be lost.
  if (dict.get(N("Mask"))) return null;
  // A soft mask may differ in size from its image, except when it has /Matte.
  const softMask = dict.lookup(N("SMask"));
  if (softMask instanceof PDFRawStream && softMask.dict.get(N("Matte"))) return null;
  if (numberOf(dict, "BitsPerComponent") !== 8) return null;

  const width = numberOf(dict, "Width", 0);
  const height = numberOf(dict, "Height", 0);
  if (!width || !height || width * height > MAX_PIXELS) return null;

  const components = colorComponents(dict);
  if (!components) return null;

  const filters = filterNames(dict);
  if (filters.length === 1 && filters[0] === "DCTDecode") {
    return { kind: "jpeg", bytes: stream.contents, width, height };
  }
  if (filters.length !== 1 || filters[0] !== "FlateDecode") return null;

  const parms = decodeParms(dict);
  const predictor = parms ? numberOf(parms, "Predictor", 1) : 1;
  if (predictor !== 1 && predictor < 10) return null;
  if (predictor >= 10 && numberOf(parms, "Colors", 1) !== components) return null;

  let pixels: Uint8Array;
  try {
    pixels = await codec.inflate(stream.contents);
    if (predictor >= 10) {
      pixels = unpredictPng(pixels, numberOf(parms, "Columns", width), components, 8);
    }
  } catch {
    return null;
  }
  if (pixels.length < width * height * components) return null;

  return {
    kind: "raw",
    pixels: pixels.subarray(0, width * height * components),
    width,
    height,
    components,
  };
}
