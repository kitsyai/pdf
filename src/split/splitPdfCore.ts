import { PDFDocument } from "pdf-lib";
import { loadPdf } from "../shared/files";
import { parsePageGroups, parsePageSelection } from "../shared/pageRanges";
import { producerName } from "../config";

export type SplitMode = "ranges" | "every" | "extract";

export type SplitPdfOptions = {
  mode: SplitMode;
  /** 1-based selection. "ranges": one file per comma part. "extract": one file. */
  ranges?: string;
  /** "every": pages per output file. */
  every?: number;
  baseName?: string;
};

export type SplitPdfOutput = { name: string; pageIndices: number[]; bytes: Uint8Array };

function rangeLabel(indices: number[]) {
  const first = indices[0] + 1;
  const last = indices[indices.length - 1] + 1;
  return indices.length === 1 ? `p${first}` : `p${first}-${last}`;
}

/** Work out which pages go into which output file, without touching PDF bytes. */
export function planSplit(pageCount: number, options: SplitPdfOptions) {
  if (pageCount < 1) {
    throw new Error("This PDF has no pages.");
  }

  if (options.mode === "every") {
    const size = Math.floor(Number(options.every));
    if (!Number.isFinite(size) || size < 1) {
      throw new Error("Pages per file must be a whole number of at least 1.");
    }
    const groups: number[][] = [];
    for (let start = 0; start < pageCount; start += size) {
      groups.push(
        Array.from({ length: Math.min(size, pageCount - start) }, (_, offset) => start + offset)
      );
    }
    return groups;
  }

  if (options.mode === "extract") {
    if (!(options.ranges || "").trim()) {
      throw new Error("Enter the pages to extract, e.g. 1-3, 5.");
    }
    return [parsePageSelection(options.ranges, pageCount)];
  }

  if (!(options.ranges || "").trim()) {
    throw new Error("Enter at least one page range, e.g. 1-3, 4-6.");
  }
  return parsePageGroups(options.ranges, pageCount);
}

export async function splitPdf(bytes: ArrayBuffer | Uint8Array, options: SplitPdfOptions) {
  const source = await loadPdf(bytes);
  const groups = planSplit(source.getPageCount(), options);
  const baseName = options.baseName || "document";
  const outputs: SplitPdfOutput[] = [];

  for (const indices of groups) {
    const out = await PDFDocument.create();
    const pages = await out.copyPages(source, indices);
    pages.forEach((page) => out.addPage(page));

    const title = source.getTitle();
    if (title) out.setTitle(title);
    out.setProducer(producerName());
    out.setCreationDate(new Date());

    outputs.push({
      name:
        options.mode === "extract"
          ? `${baseName}-extracted.pdf`
          : `${baseName}-${rangeLabel(indices)}.pdf`,
      pageIndices: indices,
      bytes: await out.save(),
    });
  }

  // Ranges like "1, 1" would otherwise produce two files with the same name.
  const seen = new Map<string, number>();
  for (const output of outputs) {
    const count = (seen.get(output.name) || 0) + 1;
    seen.set(output.name, count);
    if (count > 1) output.name = output.name.replace(/\.pdf$/, `-${count}.pdf`);
  }

  return outputs;
}
