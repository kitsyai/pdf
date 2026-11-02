// Browser-only page rendering via pdf.js. Loaded lazily so tools that only
// edit PDFs (pdf-lib) never pay for it.

import { getPdfConfig, requireAsset } from "../config";

let pdfjsPromise = null;

export function loadPdfJs() {
  if (!pdfjsPromise) {
    const workerSrc = requireAsset("pdfjsWorkerSrc", "Rendering PDF pages");
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      return pdfjs;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

/**
 * Open a PDF for rendering. pdf.js transfers the buffer it is given to its
 * worker (leaving it empty), so it always gets a copy.
 */
export async function openRenderDocument(bytes: ArrayBuffer | Uint8Array) {
  const pdfjs = await loadPdfJs();
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
  try {
    // CMaps and standard fonts are optional and served by the host app.
    const base = getPdfConfig().pdfjsAssetsBase?.replace(/\/+$/, "");
    return await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      ...(base
        ? { cMapUrl: `${base}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}/standard_fonts/` }
        : {}),
    }).promise;
  } catch (error) {
    if (error?.name === "PasswordException") {
      throw new Error("This PDF is password protected. Remove the password with Protect / Unlock PDF first.");
    }
    throw new Error("This file is not a readable PDF.");
  }
}

/**
 * Render one page (1-based) as it appears in a viewer: CropBox and /Rotate
 * applied. Returns the canvas and its CSS-pixel size at scale 1.
 */
export async function renderPageToCanvas(
  doc,
  pageNumber: number,
  { scale = 1, background = "#ffffff", maxPixels = 16_000_000 } = {}
) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const pixelLimit = Math.sqrt(maxPixels / (base.width * base.height));
  const appliedScale = Math.min(scale, pixelLimit);
  const viewport = page.getViewport({ scale: appliedScale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: context, viewport }).promise;
  page.cleanup();

  return {
    canvas,
    width: base.width,
    height: base.height,
    scale: appliedScale,
    reduced: appliedScale < scale,
  };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image."))),
      type,
      quality
    );
  });
}

/** Render a small thumbnail as an object URL. Caller revokes it. */
export async function renderThumbnail(doc, pageNumber: number, targetWidth = 180) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const ratio = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const { canvas, width, height } = await renderPageToCanvas(doc, pageNumber, {
    scale: (targetWidth / base.width) * ratio,
  });
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.8);
  return { url: URL.createObjectURL(blob), width, height };
}
