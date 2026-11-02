import { PDFImage, degrees } from "pdf-lib";
import { loadPdf } from "../shared/files";
import { textOrigin, visualSize } from "../shared/pageGeometry";

/**
 * A signature image placed on a page. x/y/width/height are fractions (0-1)
 * of the visible page, measured from its top-left corner, as on screen.
 */
export type SignaturePlacement = {
  pageIndex: number;
  image: Uint8Array;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Convert a top-left fractional box into a bottom-left box in visual points. */
export function placementToVisual(
  placement: Pick<SignaturePlacement, "x" | "y" | "width" | "height">,
  visualWidth: number,
  visualHeight: number
) {
  const width = placement.width * visualWidth;
  const height = placement.height * visualHeight;
  return {
    vx: placement.x * visualWidth,
    vy: visualHeight - placement.y * visualHeight - height,
    width,
    height,
  };
}

export async function applySignatures(
  bytes: ArrayBuffer | Uint8Array,
  placements: SignaturePlacement[]
) {
  if (!placements.length) {
    throw new Error("Place at least one signature first.");
  }

  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const embedded = new Map<Uint8Array, PDFImage>();

  for (const placement of placements) {
    const page = pages[placement.pageIndex];
    if (!page) {
      throw new Error(`Page ${placement.pageIndex + 1} does not exist.`);
    }

    let image = embedded.get(placement.image);
    if (!image) {
      image = await doc.embedPng(placement.image);
      embedded.set(placement.image, image);
    }

    const { visualWidth, visualHeight } = visualSize(page);
    const box = placementToVisual(placement, visualWidth, visualHeight);
    const origin = textOrigin(page, box.vx, box.vy);
    page.drawImage(image, {
      x: origin.x,
      y: origin.y,
      width: box.width,
      height: box.height,
      rotate: degrees(origin.angle),
    });
  }

  return doc.save();
}
