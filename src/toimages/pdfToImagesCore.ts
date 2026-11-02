export type ImageFormat = "png" | "jpeg";

export const IMAGE_FORMATS: Record<ImageFormat, { label: string; mime: string; extension: string }> = {
  png: { label: "PNG (sharp, larger)", mime: "image/png", extension: "png" },
  jpeg: { label: "JPG (smaller)", mime: "image/jpeg", extension: "jpg" },
};

export const DPI_OPTIONS = [72, 150, 220, 300];

/** PDF user space is 72 points per inch. */
export function dpiToScale(dpi: number) {
  return Math.max(0.1, Number(dpi) || 72) / 72;
}

/** "report-page-07.png": zero-padded so files sort in page order. */
export function imageFileName(baseName: string, pageNumber: number, pageCount: number, format: ImageFormat) {
  const digits = String(Math.max(pageCount, 1)).length;
  const page = String(pageNumber).padStart(digits, "0");
  return `${baseName}-page-${page}.${IMAGE_FORMATS[format].extension}`;
}

/** Pixel size of a page rendered at the given DPI, before any browser limits. */
export function renderedSize(widthPoints: number, heightPoints: number, dpi: number) {
  const scale = dpiToScale(dpi);
  return { width: Math.floor(widthPoints * scale), height: Math.floor(heightPoints * scale) };
}
