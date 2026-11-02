import { describe, expect, it } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import {
  formatPageNumber,
  hexToRgb,
  pageNumberAnchor,
  planStampedPages,
  stampPdf,
  textOrigin,
  visualToUser,
} from "./stampPdfCore";

async function makePdf(count: number, rotation = 0) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i += 1) {
    const page = doc.addPage([600, 800]);
    if (rotation) page.setRotation(degrees(rotation));
  }
  return doc.save();
}

async function contentLength(bytes: Uint8Array, pageIndex: number) {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(pageIndex).node.Contents();
  return contents ? String(contents).length : 0;
}

describe("helpers", () => {
  it("formats page number tokens", () => {
    expect(formatPageNumber("Page {n} of {total}", 2, 9)).toBe("Page 2 of 9");
    expect(formatPageNumber("", 4, 9)).toBe("4");
  });

  it("parses hex colours with a fallback", () => {
    expect(hexToRgb("#ff0000")).toEqual({ type: "RGB", red: 1, green: 0, blue: 0 });
    expect(hexToRgb("nope", "#000000")).toEqual({ type: "RGB", red: 0, green: 0, blue: 0 });
  });

  it("numbers each selected page once, honouring startAt", () => {
    expect(planStampedPages([1, 1, 2], 5)).toEqual([
      { pageIndex: 1, n: 5, total: 6 },
      { pageIndex: 2, n: 6, total: 6 },
    ]);
    // Typed out of order, numbered in page order.
    expect(planStampedPages([2, 0])).toEqual([
      { pageIndex: 0, n: 1, total: 2 },
      { pageIndex: 2, n: 2, total: 2 },
    ]);
    expect(planStampedPages([0, 1], 0)).toEqual([
      { pageIndex: 0, n: 1, total: 2 },
      { pageIndex: 1, n: 2, total: 2 },
    ]);
  });

  it("places page numbers by position", () => {
    expect(pageNumberAnchor("bottom-center", 600, 800, 40, 10, 20)).toEqual({ vx: 280, vy: 20 });
    expect(pageNumberAnchor("top-right", 600, 800, 40, 10, 20)).toEqual({ vx: 540, vy: 770 });
    expect(pageNumberAnchor("bottom-left", 600, 800, 40, 10, 20)).toEqual({ vx: 20, vy: 20 });
  });

  it("maps on-screen points into rotated page space", () => {
    const page = { width: 600, height: 800 };
    // The on-screen bottom-left corner of a rotated page.
    expect(visualToUser({ ...page, rotation: 0 }, 0, 0)).toEqual({ x: 0, y: 0, angle: 0 });
    expect(visualToUser({ ...page, rotation: 90 }, 0, 0)).toEqual({ x: 600, y: 0, angle: 90 });
    expect(visualToUser({ ...page, rotation: 180 }, 0, 0)).toEqual({ x: 600, y: 800, angle: 180 });
    expect(visualToUser({ ...page, rotation: 270 }, 0, 0)).toEqual({ x: 0, y: 800, angle: 270 });
    expect(visualToUser({ ...page, rotation: -90 }, 0, 0)).toEqual({ x: 0, y: 800, angle: 270 });
  });
});

describe("textOrigin", () => {
  async function croppedPage(rotation = 0) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    page.setCropBox(100, 100, 412, 592);
    if (rotation) page.setRotation(degrees(rotation));
    return page;
  }

  it("measures from the visible CropBox, not the MediaBox", async () => {
    const page = await croppedPage();
    expect(textOrigin(page, 0, 0)).toEqual({ x: 100, y: 100, angle: 0 });
    // A bottom-centre page number with a 28pt margin stays inside the crop.
    const { vx, vy } = pageNumberAnchor("bottom-center", 412, 592, 40, 10, 28);
    expect(textOrigin(page, vx, vy)).toEqual({ x: 286, y: 128, angle: 0 });
  });

  it("combines the CropBox offset with page rotation", async () => {
    // On-screen bottom-left of a 90°-rotated page is the crop's bottom-right.
    expect(textOrigin(await croppedPage(90), 0, 0)).toEqual({ x: 512, y: 100, angle: 90 });
    expect(textOrigin(await croppedPage(270), 0, 0)).toEqual({ x: 100, y: 692, angle: 270 });
  });
});

describe("stampPdf", () => {
  it("stamps only the selected pages", async () => {
    const source = await makePdf(3);
    const stamped = await stampPdf(source, {
      pages: "2",
      watermark: { text: "DRAFT" },
      pageNumbers: { format: "{n}" },
    });
    expect(await contentLength(stamped, 0)).toBe(await contentLength(source, 0));
    expect(await contentLength(stamped, 1)).toBeGreaterThan(await contentLength(source, 1));
    expect(await contentLength(stamped, 2)).toBe(await contentLength(source, 2));
  });

  it("works on rotated pages", async () => {
    const stamped = await stampPdf(await makePdf(1, 90), { pageNumbers: {} });
    const doc = await PDFDocument.load(stamped);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
  });

  it("requires something to stamp and rejects unsupported characters", async () => {
    const source = await makePdf(1);
    await expect(stampPdf(source, { watermark: { text: "  " } })).rejects.toThrow(/Turn on/);
    await expect(stampPdf(source, { watermark: { text: "₹ नमस्ते" } })).rejects.toThrow(
      /standard PDF font/
    );
  });
});
