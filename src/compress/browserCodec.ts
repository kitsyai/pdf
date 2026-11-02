import type { CompressTarget, ImageCodec, ImageInput } from "./compressPdfCore";

async function inflate(bytes: Uint8Array) {
  // PDF FlateDecode is zlib-wrapped deflate, which DecompressionStream calls "deflate".
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function toSource(input: ImageInput) {
  if (input.kind === "jpeg") {
    // PDF viewers ignore EXIF orientation, so must we.
    return createImageBitmap(new Blob([input.bytes as BlobPart], { type: "image/jpeg" }), {
      imageOrientation: "none",
    });
  }

  const { width, height, pixels, components } = input;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i += 1, j += components) {
    rgba[i * 4] = pixels[j];
    rgba[i * 4 + 1] = pixels[components === 3 ? j + 1 : j];
    rgba[i * 4 + 2] = pixels[components === 3 ? j + 2 : j];
    rgba[i * 4 + 3] = 255;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

async function encodeJpeg(input: ImageInput, target: CompressTarget) {
  const source = await toSource(input);
  const scale = Math.min(1, target.maxDimension / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  if ("close" in source) source.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("encode failed"))), "image/jpeg", target.quality)
  );
  canvas.width = 0;
  canvas.height = 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}

export const browserCodec: ImageCodec = { inflate, encodeJpeg };
