import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { isPdfFile, mergePdfs, parsePageSelection } from "./mergePdfCore";

async function makePdf(widths: number[]) {
  const doc = await PDFDocument.create();
  widths.forEach((width) => doc.addPage([width, 100]));
  return doc.save();
}

async function pageWidths(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getWidth());
}

describe("parsePageSelection", () => {
  it("returns every page when selection is empty", () => {
    expect(parsePageSelection("", 3)).toEqual([0, 1, 2]);
    expect(parsePageSelection("   ", 2)).toEqual([0, 1]);
  });

  it("parses single pages, ranges, and open-ended ranges in typed order", () => {
    expect(parsePageSelection("3, 1-2", 5)).toEqual([2, 0, 1]);
    expect(parsePageSelection("4-", 5)).toEqual([3, 4]);
    expect(parsePageSelection("-2", 5)).toEqual([0, 1]);
  });

  it("supports reversed ranges", () => {
    expect(parsePageSelection("3-1", 3)).toEqual([2, 1, 0]);
  });

  it("rejects out-of-range and malformed input", () => {
    expect(() => parsePageSelection("0", 3)).toThrow(/outside/);
    expect(() => parsePageSelection("2-9", 3)).toThrow(/outside/);
    expect(() => parsePageSelection("abc", 3)).toThrow(/Invalid/);
    expect(() => parsePageSelection("-", 3)).toThrow(/Invalid/);
    expect(() => parsePageSelection("1 3", 3)).toThrow(/Invalid/);
    expect(() => parsePageSelection(",", 3)).toThrow(/empty/);
  });
});

describe("isPdfFile", () => {
  it("accepts by mime type or extension", () => {
    expect(isPdfFile({ name: "a.bin", type: "application/pdf" })).toBe(true);
    expect(isPdfFile({ name: "A.PDF", type: "" })).toBe(true);
    expect(isPdfFile({ name: "a.png", type: "image/png" })).toBe(false);
  });
});

describe("mergePdfs", () => {
  it("merges files in order", async () => {
    const first = await makePdf([101, 102]);
    const second = await makePdf([201]);

    const merged = await mergePdfs([
      { name: "first.pdf", bytes: first },
      { name: "second.pdf", bytes: second },
    ]);

    expect(await pageWidths(merged)).toEqual([101, 102, 201]);
  });

  it("applies per-file page selections", async () => {
    const first = await makePdf([101, 102, 103]);
    const second = await makePdf([201, 202]);

    const merged = await mergePdfs([
      { name: "first.pdf", bytes: first, pages: "3, 1" },
      { name: "second.pdf", bytes: second, pages: "2" },
    ]);

    expect(await pageWidths(merged)).toEqual([103, 101, 202]);
  });

  it("sets the document title when provided", async () => {
    const merged = await mergePdfs([{ name: "a.pdf", bytes: await makePdf([100]) }], {
      title: "Report",
    });
    const doc = await PDFDocument.load(merged);
    expect(doc.getTitle()).toBe("Report");
  });

  it("names the failing file in errors", async () => {
    await expect(mergePdfs([])).rejects.toThrow(/at least one/);
    await expect(
      mergePdfs([{ name: "broken.pdf", bytes: new TextEncoder().encode("nope") }])
    ).rejects.toThrow(/^broken\.pdf: This file is not a readable PDF\./);
    await expect(
      mergePdfs([{ name: "short.pdf", bytes: await makePdf([100]), pages: "2" }])
    ).rejects.toThrow(/^short\.pdf: Page range "2" is outside 1-1\./);
  });
});
