import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { configurePdf, getPdfConfig, requireAsset } from "./config";
import { mergePdfs } from "./merge/mergePdfCore";
import { openRenderDocument } from "./shared/pdfRender";

async function onePage() {
  const doc = await PDFDocument.create();
  doc.addPage();
  return doc.save();
}

describe("configurePdf", () => {
  afterEach(() => configurePdf({ producer: undefined, pdfjsWorkerSrc: undefined, qpdfWasmUrl: undefined }));

  it("merges later settings into earlier ones", () => {
    configurePdf({ pdfjsWorkerSrc: "/w.mjs" });
    configurePdf({ qpdfWasmUrl: "/q.wasm" });
    expect(getPdfConfig()).toMatchObject({ pdfjsWorkerSrc: "/w.mjs", qpdfWasmUrl: "/q.wasm" });
  });

  it("names the missing option when an asset is required", async () => {
    expect(() => requireAsset("qpdfWasmUrl", "Protect / Unlock PDF")).toThrow(/configurePdf\(\{ qpdfWasmUrl \}\)/);
    await expect(openRenderDocument(await onePage())).rejects.toThrow(/pdfjsWorkerSrc/);
  });

  it("writes the configured producer, defaulting to @kitsy/pdf", async () => {
    const merged = await mergePdfs([{ name: "a.pdf", bytes: await onePage() }]);
    expect((await PDFDocument.load(merged, { updateMetadata: false })).getProducer()).toBe("@kitsy/pdf");
    configurePdf({ producer: "My App" });
    const again = await mergePdfs([{ name: "a.pdf", bytes: await onePage() }]);
    expect((await PDFDocument.load(again, { updateMetadata: false })).getProducer()).toBe("My App");
  });
});
