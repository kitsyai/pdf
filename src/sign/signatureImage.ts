// Pixel helpers for signature images (RGBA data, as in ImageData.data).

/** Make near-white pixels transparent, e.g. for a photographed signature. */
export function whiteToTransparent(data: Uint8ClampedArray, threshold = 225) {
  for (let i = 0; i < data.length; i += 4) {
    const lightest = Math.min(data[i], data[i + 1], data[i + 2]);
    if (lightest >= threshold) {
      data[i + 3] = 0;
    } else if (lightest > threshold - 40) {
      // Soften the edge so strokes don't look cut out.
      data[i + 3] = Math.min(data[i + 3], Math.round(((threshold - lightest) / 40) * 255));
    }
  }
  return data;
}

/** Bounding box of pixels with alpha above the threshold, or null if empty. */
export function opaqueBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 8
) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
