import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";
import { readPdfMetadata, splitKeywords, writePdfMetadata } from "./pdfMetadataCore";

async function makePdf() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage([100, 100]);
  doc.setTitle("Old title");
  doc.setAuthor("Old author");
  doc.setKeywords(["alpha", "beta"]);
  doc.setProducer("Original producer");
  doc.catalog.set(PDFName.of("Metadata"), doc.context.obj({}));
  return doc.save();
}

describe("splitKeywords", () => {
  it("splits on commas and semicolons", () => {
    expect(splitKeywords(" a, b;c ,, ")).toEqual(["a", "b", "c"]);
  });
});

describe("pdf metadata", () => {
  it("reads the file's own values", async () => {
    const meta = await readPdfMetadata(await makePdf());
    expect(meta).toMatchObject({
      title: "Old title",
      author: "Old author",
      keywords: "alpha beta",
      producer: "Original producer",
      pageCount: 1,
      hasXmp: true,
    });
  });

  it("writes edited fields and can strip XMP", async () => {
    const now = new Date("2026-01-02T03:04:05Z");
    const updated = await writePdfMetadata(
      await makePdf(),
      { title: " New title ", author: "", keywords: "x, y" },
      { stripXmp: true, now }
    );
    const meta = await readPdfMetadata(updated);
    expect(meta).toMatchObject({
      title: "New title",
      author: "",
      keywords: "x y",
      producer: "Original producer",
      hasXmp: false,
    });
    expect(meta.modificationDate?.toISOString()).toBe(now.toISOString());
  });
});
