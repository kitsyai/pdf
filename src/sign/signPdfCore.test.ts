import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFRawStream, degrees } from "pdf-lib";
import { encodePng } from "../test-utils/png";
import { applySignatures, placementToVisual } from "./signPdfCore";
import { opaqueBounds, whiteToTransparent } from "./signatureImage";

const SIGNATURE = encodePng(4, 2, new Uint8Array(4 * 2 * 4).fill(200), 4);

function imageCount(doc: PDFDocument) {
  return doc.context
    .enumerateIndirectObjects()
    .filter(
      ([, object]) =>
        object instanceof PDFRawStream &&
        object.dict.lookup(PDFName.of("Subtype")) === PDFName.of("Image") &&
        !object.dict.get(PDFName.of("ColorSpace"))?.toString().includes("Gray")
    ).length;
}

describe("placementToVisual", () => {
  it("converts a top-left fractional box to bottom-left points", () => {
    expect(placementToVisual({ x: 0.5, y: 0.25, width: 0.25, height: 0.1 }, 600, 800)).toEqual({
      vx: 300,
      vy: 520,
      width: 150,
      height: 80,
    });
  });
});

describe("applySignatures", () => {
  it("embeds a reused signature once across pages, including rotated ones", async () => {
    const source = await PDFDocument.create();
    source.addPage([600, 800]);
    source.addPage([600, 800]).setRotation(degrees(90));
    const bytes = await source.save();

    const out = await applySignatures(bytes, [
      { pageIndex: 0, image: SIGNATURE, x: 0.1, y: 0.8, width: 0.3, height: 0.05 },
      { pageIndex: 1, image: SIGNATURE, x: 0.6, y: 0.8, width: 0.3, height: 0.05 },
    ]);
    const doc = await PDFDocument.load(out);
    expect(imageCount(doc)).toBe(1);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
  });

  it("validates input", async () => {
    const source = await PDFDocument.create();
    source.addPage();
    const bytes = await source.save();
    await expect(applySignatures(bytes, [])).rejects.toThrow(/at least one/);
    await expect(
      applySignatures(bytes, [{ pageIndex: 3, image: SIGNATURE, x: 0, y: 0, width: 0.1, height: 0.1 }])
    ).rejects.toThrow(/Page 4 does not exist/);
  });
});

describe("signature image helpers", () => {
  it("turns near-white pixels transparent and softens edges", () => {
    const data = Uint8ClampedArray.from([255, 255, 255, 255, 20, 20, 20, 255, 205, 205, 205, 255]);
    whiteToTransparent(data, 225);
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
    expect(data[11]).toBe(128);
  });

  it("finds the bounding box of visible pixels", () => {
    const width = 4;
    const height = 3;
    const data = new Uint8ClampedArray(width * height * 4);
    data[(1 * width + 1) * 4 + 3] = 255;
    data[(2 * width + 2) * 4 + 3] = 255;
    expect(opaqueBounds(data, width, height)).toEqual({ x: 1, y: 1, width: 2, height: 2 });
    expect(opaqueBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
});
