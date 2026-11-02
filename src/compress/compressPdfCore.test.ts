import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import { encodePng, noisePixels } from "../test-utils/png";
import { colorComponents, compressPdf, unpredictPng, type ImageCodec, type ImageInput } from "./compressPdfCore";

function fakeCodec(outputBytes = 1000) {
  const calls: ImageInput[] = [];
  const codec: ImageCodec = {
    inflate: async (bytes) => new Uint8Array(inflateSync(bytes)),
    encodeJpeg: async (input, target) => {
      calls.push(input);
      const scale = Math.min(1, target.maxDimension / Math.max(input.width, input.height));
      return {
        bytes: new Uint8Array(outputBytes).fill(7),
        width: Math.round(input.width * scale),
        height: Math.round(input.height * scale),
      };
    },
  };
  return { codec, calls };
}

function images(doc: PDFDocument) {
  return doc.context
    .enumerateIndirectObjects()
    .filter(([, object]) => object instanceof PDFRawStream && object.dict.lookup(PDFName.of("Subtype")) === PDFName.of("Image")) as Array<[PDFRef, PDFRawStream]>;
}

async function pdfWithRgbImage(withAlpha = false) {
  const width = 120;
  const height = 80;
  const channels = withAlpha ? 4 : 3;
  const pixels = noisePixels(width * height * channels);
  const doc = await PDFDocument.create();
  doc.setTitle("Scans");
  const image = await doc.embedPng(encodePng(width, height, pixels, channels));
  doc.addPage([300, 300]).drawImage(image, { x: 0, y: 0, width: 300, height: 200 });
  return { bytes: await doc.save(), pixels, channels };
}

const TARGET = { maxDimension: 60, quality: 0.7 };

describe("unpredictPng", () => {
  it("reverses None, Sub, Up, Average, and Paeth rows", () => {
    // 2 pixels x 1 colour per row.
    const encoded = Uint8Array.from([
      0, 10, 20, // None
      1, 5, 5, // Sub: 5, 10
      2, 1, 1, // Up: 6, 11
      3, 3, 2, // Average: 6+floor((0+6)/2)=... see below
      4, 1, 1, // Paeth
    ]);
    const out = unpredictPng(encoded, 2, 1);
    expect(Array.from(out.subarray(0, 2))).toEqual([10, 20]);
    expect(Array.from(out.subarray(2, 4))).toEqual([5, 10]);
    expect(Array.from(out.subarray(4, 6))).toEqual([6, 11]);
    // Average: [3 + floor((0 + 6) / 2), 2 + floor((6 + 11) / 2)] = [6, 10]
    expect(Array.from(out.subarray(6, 8))).toEqual([6, 10]);
    // Paeth: first byte predictor = up (6) -> 7; second: p=7+10-6=11 -> up(10) -> 11
    expect(Array.from(out.subarray(8, 10))).toEqual([7, 11]);
  });

  it("rejects unknown filter types", () => {
    expect(() => unpredictPng(Uint8Array.from([9, 1, 1]), 2, 1)).toThrow(/Unknown PNG filter/);
  });
});

describe("compressPdf", () => {
  it("re-encodes a Flate RGB image and keeps the document intact", async () => {
    const { bytes, pixels } = await pdfWithRgbImage();
    const { codec, calls } = fakeCodec();
    const { bytes: out, stats } = await compressPdf(bytes, TARGET, codec);

    expect(stats).toMatchObject({ images: 1, compressed: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: "raw", width: 120, height: 80, components: 3 });
    expect(Array.from((calls[0] as { pixels: Uint8Array }).pixels.subarray(0, 6))).toEqual(Array.from(pixels.subarray(0, 6)));

    const doc = await PDFDocument.load(out);
    expect(doc.getTitle()).toBe("Scans");
    const [[, image]] = images(doc);
    expect(image.dict.lookup(PDFName.of("Filter"))).toBe(PDFName.of("DCTDecode"));
    expect(image.dict.lookup(PDFName.of("Width"))?.toString()).toBe("60");
    expect(image.dict.lookup(PDFName.of("Height"))?.toString()).toBe("40");
    expect(image.dict.get(PDFName.of("DecodeParms"))).toBeUndefined();
    expect(image.contents.length).toBe(1000);
  });

  it("never re-encodes a soft mask but keeps it on the new image", async () => {
    const { bytes } = await pdfWithRgbImage(true);
    const { codec, calls } = fakeCodec();
    const { bytes: out, stats } = await compressPdf(bytes, TARGET, codec);

    expect(stats.images).toBe(2);
    expect(calls.map((call) => call.kind === "raw" && call.components)).toEqual([3]);
    const doc = await PDFDocument.load(out);
    const rgb = images(doc).find(([, stream]) => stream.dict.get(PDFName.of("SMask")));
    expect(rgb?.[1].dict.lookup(PDFName.of("Filter"))).toBe(PDFName.of("DCTDecode"));
  });

  it("keeps the original when re-encoding would not save enough", async () => {
    const { bytes } = await pdfWithRgbImage();
    const original = images(await PDFDocument.load(bytes))[0][1].contents.length;
    const { codec } = fakeCodec(original);
    const { stats } = await compressPdf(bytes, TARGET, codec);
    expect(stats.compressed).toBe(0);
  });

  it("passes JPEG streams through and skips CMYK, Decode arrays, and small images", async () => {
    const doc = await PDFDocument.create();
    const big = new Uint8Array(20000).fill(1);
    const add = (dict: Record<string, unknown>, contents = big) =>
      doc.context.register(
        doc.context.stream(contents, { Type: "XObject", Subtype: "Image", BitsPerComponent: 8, Width: 400, Height: 300, ...dict })
      );
    add({ ColorSpace: "DeviceRGB", Filter: "DCTDecode" });
    add({ ColorSpace: "DeviceCMYK", Filter: "DCTDecode" });
    add({ ColorSpace: "DeviceGray", Filter: "DCTDecode", Decode: [1, 0] });
    add({ ColorSpace: "DeviceRGB", Filter: "DCTDecode" }, new Uint8Array(100));
    doc.addPage();

    const { codec, calls } = fakeCodec();
    const { stats } = await compressPdf(await doc.save(), TARGET, codec);
    expect(stats).toMatchObject({ images: 4, compressed: 1 });
    expect(calls).toEqual([{ kind: "jpeg", bytes: expect.any(Uint8Array), width: 400, height: 300 }]);
  });

  it("leaves images that carry a colour-key or stencil /Mask untouched", async () => {
    for (const makeMask of [
      (doc: PDFDocument) => doc.context.obj([255, 255, 255, 255, 255, 255]),
      (doc: PDFDocument) =>
        doc.context.register(
          doc.context.stream(new Uint8Array(8), { Type: "XObject", Subtype: "Image", ImageMask: true, Width: 8, Height: 8 })
        ),
    ]) {
      const doc = await PDFDocument.load((await pdfWithRgbImage()).bytes);
      const [[, image]] = images(doc);
      const mask = makeMask(doc);
      image.dict.set(PDFName.of("Mask"), mask);

      const { codec, calls } = fakeCodec();
      const { bytes: out, stats } = await compressPdf(await doc.save(), TARGET, codec);
      expect(stats.compressed).toBe(0);
      expect(calls).toHaveLength(0);

      const [[, kept]] = images(await PDFDocument.load(out)).filter(([, stream]) => stream.dict.get(PDFName.of("Mask")));
      expect(kept.dict.lookup(PDFName.of("Filter"))).toBe(PDFName.of("FlateDecode"));
      expect(kept.dict.get(PDFName.of("Mask"))?.toString()).toBe(mask.toString());
    }
  });

  it("reads ICCBased colour spaces by component count", async () => {
    const doc = await PDFDocument.create();
    const profile = doc.context.register(doc.context.stream(new Uint8Array(4), { N: 3 }));
    const dict = doc.context.obj({ ColorSpace: [PDFName.of("ICCBased"), profile] });
    expect(colorComponents(dict)).toBe(3);
    expect(colorComponents(doc.context.obj({ ColorSpace: "DeviceCMYK" }))).toBeNull();
  });
});
