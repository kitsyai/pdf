import { PDFDocument } from "pdf-lib";
import { loadPdf } from "../shared/files";
import { parsePageSelection } from "../shared/pageRanges";
import { producerName } from "../config";

export { isPdfFile, getPdfPageCount, loadPdf } from "../shared/files";
export { parsePageSelection } from "../shared/pageRanges";

export type MergePdfSource = {
  name: string;
  bytes: ArrayBuffer | Uint8Array;
  /** Optional 1-based page selection, e.g. "1-3, 5, 8-". Empty means all pages. */
  pages?: string;
};

export type MergePdfOptions = {
  title?: string;
};

export async function mergePdfs(sources: MergePdfSource[], options: MergePdfOptions = {}) {
  if (!sources.length) {
    throw new Error("Add at least one PDF to merge.");
  }

  const merged = await PDFDocument.create();

  for (const source of sources) {
    let doc: PDFDocument;
    try {
      doc = await loadPdf(source.bytes);
    } catch (error) {
      throw new Error(`${source.name}: ${(error as Error).message}`);
    }

    let indices: number[];
    try {
      indices = parsePageSelection(source.pages, doc.getPageCount());
    } catch (error) {
      throw new Error(`${source.name}: ${(error as Error).message}`);
    }

    const pages = await merged.copyPages(doc, indices);
    pages.forEach((page) => merged.addPage(page));
  }

  if (options.title) merged.setTitle(options.title);
  merged.setProducer(producerName());
  merged.setCreationDate(new Date());

  return merged.save();
}
