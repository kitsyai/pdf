import { PDFDocument } from "pdf-lib";
import { producerName } from "../config";

export type ImageKind = "png" | "jpg";
export type PageSizeOption = "fit" | "a4" | "letter";
export type OrientationOption = "auto" | "portrait" | "landscape";

export type ImageSource = { name: string; bytes: ArrayBuffer | Uint8Array };

export type ImagesToPdfOptions = {
  pageSize?: PageSizeOption;
  orientation?: OrientationOption;
  /** Margin in PDF points (1/72 inch). */
  margin?: number;
  title?: string;
};

// Portrait width x height in PDF points.
export const PAGE_SIZES: Record<
  Exclude<PageSizeOption, "fit">,
  [number, number]
> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

export function detectImageKind(
  bytes: ArrayBuffer | Uint8Array,
): ImageKind | null {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (
    view.length >= 8 &&
    view[0] === 0x89 &&
    view[1] === 0x50 &&
    view[2] === 0x4e &&
    view[3] === 0x47
  ) {
    return "png";
  }
  if (
    view.length >= 3 &&
    view[0] === 0xff &&
    view[1] === 0xd8 &&
    view[2] === 0xff
  ) {
    return "jpg";
  }
  return null;
}

/**
 * Read the EXIF orientation (1-8) from a JPEG, or 1 when absent. Values other
 * than 1 mean viewers rotate/flip the photo, which pdf-lib does not do.
 */
export function getJpegOrientation(bytes: ArrayBuffer | Uint8Array) {
  const view = new DataView(
    bytes instanceof Uint8Array ? bytes.buffer : bytes,
    bytes instanceof Uint8Array ? bytes.byteOffset : 0,
    bytes.byteLength,
  );
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    const length = view.getUint16(offset + 2);

    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      if (tiff + 8 > view.byteLength) return 1;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > view.byteLength) return 1;
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > view.byteLength) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset += 2 + length;
  }
  return 1;
}

/**
 * Page size and image placement for one image. For "fit" the page wraps the
 * image (plus margin); otherwise the image is scaled down to fit and centred.
 */
export function layoutImage(
  imageWidth: number,
  imageHeight: number,
  {
    pageSize = "a4",
    orientation = "auto",
    margin = 0,
  }: ImagesToPdfOptions = {},
) {
  const safeMargin = Math.max(0, margin);

  if (pageSize === "fit") {
    return {
      pageWidth: imageWidth + safeMargin * 2,
      pageHeight: imageHeight + safeMargin * 2,
      x: safeMargin,
      y: safeMargin,
      width: imageWidth,
      height: imageHeight,
    };
  }

  const [portraitWidth, portraitHeight] = PAGE_SIZES[pageSize];
  const landscape =
    orientation === "landscape" ||
    (orientation === "auto" && imageWidth > imageHeight);
  const pageWidth = landscape ? portraitHeight : portraitWidth;
  const pageHeight = landscape ? portraitWidth : portraitHeight;

  const boxWidth = Math.max(1, pageWidth - safeMargin * 2);
  const boxHeight = Math.max(1, pageHeight - safeMargin * 2);
  const scale = Math.min(1, boxWidth / imageWidth, boxHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  };
}

export async function imagesToPdf(
  images: ImageSource[],
  options: ImagesToPdfOptions = {},
) {
  if (!images.length) {
    throw new Error("Add at least one image.");
  }

  const doc = await PDFDocument.create();

  for (const image of images) {
    const kind = detectImageKind(image.bytes);
    if (!kind) {
      throw new Error(
        `${image.name}: only PNG and JPG images can be embedded.`,
      );
    }

    let embedded;
    try {
      embedded =
        kind === "png"
          ? await doc.embedPng(image.bytes)
          : await doc.embedJpg(image.bytes);
    } catch {
      throw new Error(`${image.name}: this image could not be read.`);
    }

    const box = layoutImage(embedded.width, embedded.height, options);
    const page = doc.addPage([box.pageWidth, box.pageHeight]);
    page.drawImage(embedded, {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });
  }

  if (options.title) doc.setTitle(options.title);
  doc.setProducer(producerName());
  doc.setCreationDate(new Date());

  return doc.save();
}
