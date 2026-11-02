import { PDFPage } from "pdf-lib";

// On-screen ("visual") page geometry: what a viewer shows is the CropBox,
// turned by the page's /Rotate. Tools position things in visual space and
// convert to PDF user space here.

export function normalizeRotation(angle: number) {
  return (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
}

/**
 * Map a point in the page's on-screen ("visual") space to PDF user space,
 * accounting for the page's /Rotate. Returns the user-space point and the
 * extra text rotation needed for text to read upright on screen.
 */
export function visualToUser(
  page: { width: number; height: number; rotation: number },
  vx: number,
  vy: number
) {
  const { width: w, height: h } = page;
  switch (normalizeRotation(page.rotation)) {
    case 90:
      return { x: w - vy, y: vx, angle: 90 };
    case 180:
      return { x: w - vx, y: h - vy, angle: 180 };
    case 270:
      return { x: vy, y: h - vx, angle: 270 };
    default:
      return { x: vx, y: vy, angle: 0 };
  }
}

export function visualSize(page: PDFPage) {
  // Viewers show the CropBox (it defaults to the MediaBox), which may be
  // smaller than the page and need not start at the origin.
  const { x, y, width, height } = page.getCropBox();
  const rotation = normalizeRotation(page.getRotation().angle);
  const swapped = rotation === 90 || rotation === 270;
  return {
    x,
    y,
    width,
    height,
    rotation,
    visualWidth: swapped ? height : width,
    visualHeight: swapped ? width : height,
  };
}

/** Where on-screen point (vx, vy) of the visible page lands in PDF user space. */
export function textOrigin(page: PDFPage, vx: number, vy: number) {
  const geometry = visualSize(page);
  const point = visualToUser(geometry, vx, vy);
  return { x: geometry.x + point.x, y: geometry.y + point.y, angle: point.angle };
}
