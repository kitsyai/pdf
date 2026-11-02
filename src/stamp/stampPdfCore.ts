import { PDFFont, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import { loadPdf } from "../shared/files";
import { parsePageSelection } from "../shared/pageRanges";
import { textOrigin, visualSize } from "../shared/pageGeometry";

export { textOrigin, visualToUser } from "../shared/pageGeometry";

export type NumberPosition =
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "top-left"
  | "top-center"
  | "top-right";

export type WatermarkOptions = {
  text: string;
  fontSize?: number;
  /** 0-1 */
  opacity?: number;
  /** Degrees, counter-clockwise, as seen on screen. */
  rotation?: number;
  /** "#rrggbb" */
  color?: string;
};

export type PageNumberOptions = {
  /** Tokens: {n} page number, {total} numbered page count. */
  format?: string;
  position?: NumberPosition;
  fontSize?: number;
  startAt?: number;
  margin?: number;
  color?: string;
};

export type StampPdfOptions = {
  /** 1-based selection of pages to stamp. Empty means all pages. */
  pages?: string;
  watermark?: WatermarkOptions | null;
  pageNumbers?: PageNumberOptions | null;
};

export function hexToRgb(hex: string | undefined, fallback = "#64748b") {
  const value = /^#?[0-9a-f]{6}$/i.test(hex || "") ? hex : fallback;
  const clean = value.replace("#", "");
  return rgb(
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255
  );
}

export function formatPageNumber(format: string | undefined, n: number, total: number) {
  return (format || "{n}").replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(total));
}

function measure(font: PDFFont, text: string, size: number) {
  try {
    return {
      width: font.widthOfTextAtSize(text, size),
      height: font.heightAtSize(size, { descender: false }),
    };
  } catch {
    throw new Error(
      `"${text}" contains characters the standard PDF font cannot draw. Use basic Latin letters, numbers, and punctuation.`
    );
  }
}

function drawVisualText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  { vx, vy, size, angle = 0, color, opacity = 1 }
) {
  const point = textOrigin(page, vx, vy);
  page.drawText(text, {
    x: point.x,
    y: point.y,
    size,
    font,
    color,
    opacity,
    rotate: degrees(point.angle + angle),
  });
}

export function pageNumberAnchor(
  position: NumberPosition,
  visualWidth: number,
  visualHeight: number,
  textWidth: number,
  textHeight: number,
  margin: number
) {
  const [vertical, horizontal] = position.split("-");
  const vy = vertical === "top" ? visualHeight - margin - textHeight : margin;
  let vx = (visualWidth - textWidth) / 2;
  if (horizontal === "left") vx = margin;
  if (horizontal === "right") vx = visualWidth - margin - textWidth;
  return { vx, vy };
}

/**
 * Which pages get stamped and the number each one shows. Pages listed twice
 * are stamped once; numbering counts only stamped pages.
 */
export function planStampedPages(targets: number[], startAt = 1) {
  // Stamping never reorders pages, so number them in document order.
  const unique = [...new Set(targets)].sort((a, b) => a - b);
  const first = Math.floor(Number(startAt)) || 1;
  const total = unique.length + first - 1;
  return unique.map((pageIndex, order) => ({ pageIndex, n: order + first, total }));
}

export async function stampPdf(bytes: ArrayBuffer | Uint8Array, options: StampPdfOptions) {
  const watermark = options.watermark?.text?.trim() ? options.watermark : null;
  const pageNumbers = options.pageNumbers || null;
  if (!watermark && !pageNumbers) {
    throw new Error("Turn on a watermark or page numbers first.");
  }

  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const targets = parsePageSelection(options.pages, pages.length);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  planStampedPages(targets, pageNumbers?.startAt ?? 1).forEach(({ pageIndex, n, total }) => {
    const page = pages[pageIndex];
    const { visualWidth, visualHeight } = visualSize(page);

    if (watermark) {
      const size = Math.max(6, Number(watermark.fontSize) || 48);
      const text = watermark.text.trim();
      const { width, height } = measure(boldFont, text, size);
      const angle = Number(watermark.rotation ?? 45);
      const radians = (angle * Math.PI) / 180;
      // Start the baseline so the text's centre sits on the page centre.
      const vx = visualWidth / 2 - (width / 2) * Math.cos(radians) + (height / 2) * Math.sin(radians);
      const vy = visualHeight / 2 - (width / 2) * Math.sin(radians) - (height / 2) * Math.cos(radians);
      drawVisualText(page, boldFont, text, {
        vx,
        vy,
        size,
        angle,
        color: hexToRgb(watermark.color, "#e11d48"),
        opacity: Math.min(1, Math.max(0.05, Number(watermark.opacity ?? 0.2))),
      });
    }

    if (pageNumbers) {
      const size = Math.max(6, Number(pageNumbers.fontSize) || 11);
      const text = formatPageNumber(pageNumbers.format, n, total);
      const { width, height } = measure(font, text, size);
      const { vx, vy } = pageNumberAnchor(
        pageNumbers.position || "bottom-center",
        visualWidth,
        visualHeight,
        width,
        height,
        Math.max(0, Number(pageNumbers.margin ?? 28))
      );
      drawVisualText(page, font, text, {
        vx,
        vy,
        size,
        color: hexToRgb(pageNumbers.color, "#334155"),
      });
    }
  });

  return doc.save();
}
