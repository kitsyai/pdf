import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { detectImageKind, getJpegOrientation, imagesToPdf, layoutImage } from "./imagesToPdfCore";

// 1x1 PNG and 1x1 JPEG.
const PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  ),
  (char) => char.charCodeAt(0)
);
const JPG_1X1 = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
  ),
  (char) => char.charCodeAt(0)
);

describe("detectImageKind", () => {
  it("sniffs PNG and JPEG by magic bytes", () => {
    expect(detectImageKind(PNG_1X1)).toBe("png");
    expect(detectImageKind(JPG_1X1)).toBe("jpg");
    expect(detectImageKind(new TextEncoder().encode("GIF89a"))).toBeNull();
  });
});

function jpegWithOrientation(value: number, littleEndian: boolean) {
  const u16 = (n: number) => (littleEndian ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
  const u32 = (n: number) =>
    littleEndian
      ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]
      : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const tiff = [
    ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...u16(1),
    ...u16(0x0112),
    ...u16(3),
    ...u32(1),
    ...u16(value),
    0,
    0,
    ...u32(0),
  ];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = app1.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...app1, 0xff, 0xd9]);
}

describe("getJpegOrientation", () => {
  it("reads the EXIF orientation in either byte order", () => {
    expect(getJpegOrientation(jpegWithOrientation(6, true))).toBe(6);
    expect(getJpegOrientation(jpegWithOrientation(3, false))).toBe(3);
  });

  it("defaults to 1 without EXIF or for non-JPEG input", () => {
    expect(getJpegOrientation(JPG_1X1)).toBe(1);
    expect(getJpegOrientation(PNG_1X1)).toBe(1);
    expect(getJpegOrientation(new Uint8Array())).toBe(1);
  });
});

describe("layoutImage", () => {
  it("wraps the page around the image for fit", () => {
    expect(layoutImage(200, 100, { pageSize: "fit", margin: 10 })).toEqual({
      pageWidth: 220,
      pageHeight: 120,
      x: 10,
      y: 10,
      width: 200,
      height: 100,
    });
  });

  it("picks landscape automatically for wide images and centres them", () => {
    const box = layoutImage(2000, 1000, { pageSize: "a4", orientation: "auto", margin: 0 });
    expect(box.pageWidth).toBeCloseTo(841.89);
    expect(box.pageHeight).toBeCloseTo(595.28);
    expect(box.width / box.height).toBeCloseTo(2);
    expect(box.x).toBeCloseTo((box.pageWidth - box.width) / 2);
    expect(box.width).toBeLessThanOrEqual(box.pageWidth);
    expect(box.height).toBeLessThanOrEqual(box.pageHeight);
  });

  it("respects a forced orientation and never upscales small images", () => {
    const box = layoutImage(100, 50, { pageSize: "letter", orientation: "portrait", margin: 36 });
    expect([box.pageWidth, box.pageHeight]).toEqual([612, 792]);
    expect([box.width, box.height]).toEqual([100, 50]);
  });
});

describe("imagesToPdf", () => {
  it("creates one page per image in order", async () => {
    const bytes = await imagesToPdf(
      [
        { name: "a.png", bytes: PNG_1X1 },
        { name: "b.jpg", bytes: JPG_1X1 },
      ],
      { pageSize: "fit", title: "Scans" }
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: 1, height: 1 });
    expect(doc.getTitle()).toBe("Scans");
  });

  it("names the unsupported image in errors", async () => {
    await expect(imagesToPdf([])).rejects.toThrow(/at least one/);
    await expect(
      imagesToPdf([{ name: "anim.gif", bytes: new TextEncoder().encode("GIF89a") }])
    ).rejects.toThrow(/^anim\.gif: only PNG and JPG/);
  });
});
