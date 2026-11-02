// Asset URLs for apps built with Vite. Resolved from @kitsy/pdf's own
// dependencies, so the pdf.js worker always matches the pdf.js it runs with.
//
//   import { configurePdf } from "@kitsy/pdf";
//   import { viteAssets } from "@kitsy/pdf/vite";
//   configurePdf(viteAssets);
import pdfjsWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import qpdfWasmUrl from "@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url";
import type { PdfConfig } from "./config";

export const viteAssets: PdfConfig = { pdfjsWorkerSrc, qpdfWasmUrl };
