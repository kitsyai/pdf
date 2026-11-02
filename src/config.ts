// Host-app settings. Bundlers resolve asset URLs differently, so the host app
// supplies them once at start-up.

export type PdfConfig = {
  /** Written to the Producer field of PDFs that tools create from scratch. Default "@kitsy/pdf". */
  producer?: string;
  /** URL of pdfjs-dist/build/pdf.worker.min.mjs. Needed for page previews and PDF to Images. */
  pdfjsWorkerSrc?: string;
  /**
   * Folder that holds pdf.js `cmaps/` and `standard_fonts/` (copied from
   * pdfjs-dist). Optional: without it, PDFs with CJK text or unembedded
   * standard fonts may render with substitute glyphs.
   */
  pdfjsAssetsBase?: string;
  /** URL of @neslinesli93/qpdf-wasm/dist/qpdf.wasm. Needed for Protect / Unlock. */
  qpdfWasmUrl?: string;
};

let current: PdfConfig = {};

/** Set asset URLs and options. Later calls merge into earlier ones. */
export function configurePdf(next: PdfConfig) {
  current = { ...current, ...next };
}

export function getPdfConfig(): Readonly<PdfConfig> {
  return current;
}

export function producerName() {
  return current.producer || "@kitsy/pdf";
}

export function requireAsset(key: "pdfjsWorkerSrc" | "qpdfWasmUrl", purpose: string) {
  const value = current[key];
  if (!value) {
    throw new Error(`@kitsy/pdf: ${purpose} needs configurePdf({ ${key} }) to be called first.`);
  }
  return value;
}
