import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { planSplit, splitPdf } from "./splitPdfCore";

async function makePdf(widths: number[]) {
  const doc = await PDFDocument.create();
  widths.forEach((width) => doc.addPage([width, 100]));
  return doc.save();
}

async function widths(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getWidth());
}

describe("planSplit", () => {
  it("splits every N pages with a short last file", () => {
    expect(planSplit(5, { mode: "every", every: 2 })).toEqual([[0, 1], [2, 3], [4]]);
    expect(planSplit(3, { mode: "every", every: 1 })).toEqual([[0], [1], [2]]);
  });

  it("uses one file per range, or one file for extract", () => {
    expect(planSplit(6, { mode: "ranges", ranges: "1-2, 5-" })).toEqual([[0, 1], [4, 5]]);
    expect(planSplit(6, { mode: "extract", ranges: "6, 1-2" })).toEqual([[5, 0, 1]]);
  });

  it("validates input", () => {
    expect(() => planSplit(3, { mode: "every", every: 0 })).toThrow(/at least 1/);
    expect(() => planSplit(3, { mode: "ranges", ranges: "" })).toThrow(/at least one/);
    expect(() => planSplit(3, { mode: "extract", ranges: " " })).toThrow(/pages to extract/);
    expect(() => planSplit(3, { mode: "ranges", ranges: "4" })).toThrow(/outside/);
  });
});

describe("splitPdf", () => {
  it("writes one PDF per range with descriptive names", async () => {
    const source = await makePdf([101, 102, 103, 104]);
    const outputs = await splitPdf(source, { mode: "ranges", ranges: "1-2, 4", baseName: "doc" });
    expect(outputs.map((output) => output.name)).toEqual(["doc-p1-2.pdf", "doc-p4.pdf"]);
    expect(await widths(outputs[0].bytes)).toEqual([101, 102]);
    expect(await widths(outputs[1].bytes)).toEqual([104]);
  });

  it("extracts selected pages into a single file", async () => {
    const source = await makePdf([101, 102, 103]);
    const [output] = await splitPdf(source, { mode: "extract", ranges: "3, 1", baseName: "doc" });
    expect(output.name).toBe("doc-extracted.pdf");
    expect(await widths(output.bytes)).toEqual([103, 101]);
  });

  it("de-duplicates repeated output names", async () => {
    const source = await makePdf([101, 102]);
    const outputs = await splitPdf(source, { mode: "ranges", ranges: "1, 1", baseName: "doc" });
    expect(outputs.map((output) => output.name)).toEqual(["doc-p1.pdf", "doc-p1-2.pdf"]);
  });

  it("rejects unreadable input", async () => {
    await expect(
      splitPdf(new TextEncoder().encode("nope"), { mode: "every", every: 1 })
    ).rejects.toThrow(/not a readable PDF/);
  });
});
