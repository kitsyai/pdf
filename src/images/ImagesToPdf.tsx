import React, { useEffect, useMemo, useRef, useState } from "react";
import { downloadBlob, formatBytes, toBaseName } from "../shared/files";
import {
  BackToPdfTools,
  FileDropzone,
  PdfToolColumns,
  PdfToolPage,
  SideTips,
  StatusBanner,
  SummaryList,
  fieldLabelClass,
  iconButtonClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../shared/ToolLayout";
import { detectImageKind, getJpegOrientation, imagesToPdf, type OrientationOption, type PageSizeOption } from "./imagesToPdfCore";

const MAX_IMAGES = 100;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

const MARGINS = [
  { value: 0, label: "None" },
  { value: 18, label: "Small" },
  { value: 36, label: "Medium" },
  { value: 72, label: "Large" },
];

let nextImageId = 0;

function isImageFile(file) {
  return (file?.type || "").startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file?.name || "");
}

/** Re-draw an image the browser can display as PNG/JPEG bytes pdf-lib can embed. */
async function rasterize(file, type) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("encode failed"))), type, 0.92)
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** PNG/JPEG pass through untouched unless EXIF says the photo is rotated. */
async function toEmbeddableBytes(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectImageKind(bytes);
  if (kind === "png") return bytes;
  if (kind === "jpg") {
    return getJpegOrientation(bytes) === 1 ? bytes : rasterize(file, "image/jpeg");
  }
  return rasterize(file, "image/png");
}

export default function ImagesToPdf() {
  const [images, setImages] = useState([]);
  const [pageSize, setPageSize] = useState<PageSizeOption>("a4");
  const [orientation, setOrientation] = useState<OrientationOption>("auto");
  const [margin, setMargin] = useState(18);
  const [outputName, setOutputName] = useState("images");
  const [isConverting, setIsConverting] = useState(false);
  const [status, setStatus] = useState({
    tone: "info",
    text: "Add JPG, PNG, or other images, arrange them, and turn them into one PDF.",
  });
  const imagesRef = useRef(images);
  imagesRef.current = images;

  useEffect(() => {
    document.title = "Images to PDF | Apps";
    return () => imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
  }, []);

  const totalBytes = useMemo(() => images.reduce((sum, image) => sum + image.file.size, 0), [images]);

  const addFiles = (files) => {
    if (!files.length) return;
    const accepted = files.filter(isImageFile);
    if (!accepted.length) {
      setStatus({ tone: "error", text: "Only image files are supported." });
      return;
    }
    if (images.length + accepted.length > MAX_IMAGES) {
      setStatus({ tone: "error", text: `Please add up to ${MAX_IMAGES} images at a time.` });
      return;
    }
    if (totalBytes + accepted.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) {
      setStatus({ tone: "error", text: `Total size must stay under ${formatBytes(MAX_TOTAL_BYTES)}.` });
      return;
    }

    setImages((current) => [
      ...current,
      ...accepted.map((file) => ({
        id: `img-${++nextImageId}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
    const skipped = files.length - accepted.length;
    setStatus({
      tone: "success",
      text: `${accepted.length} image${accepted.length > 1 ? "s" : ""} added.${
        skipped ? ` ${skipped} non-image file${skipped > 1 ? "s" : ""} skipped.` : ""
      }`,
    });
  };

  const moveImage = (index, offset) => {
    setImages((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeImage = (id) => {
    setImages((current) => {
      const removed = current.find((image) => image.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((image) => image.id !== id);
    });
  };

  const clearImages = () => {
    images.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    setImages([]);
    setStatus({ tone: "info", text: "Selection cleared. Add images to continue." });
  };

  const handleConvert = async (event) => {
    event.preventDefault();
    if (!images.length) return;

    setIsConverting(true);
    setStatus({ tone: "info", text: "Building your PDF..." });

    try {
      const sources = [];
      for (const image of images) {
        try {
          sources.push({ name: image.file.name, bytes: await toEmbeddableBytes(image.file) });
        } catch {
          throw new Error(`${image.file.name}: this image could not be read.`);
        }
      }

      const baseName = toBaseName(outputName, "images");
      const bytes = await imagesToPdf(sources, {
        pageSize,
        orientation,
        margin: Number(margin),
        title: baseName,
      });
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      downloadBlob(blob, `${baseName}.pdf`);
      setStatus({
        tone: "success",
        text: `Created a ${images.length}-page PDF (${formatBytes(blob.size)}). Your download has started.`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: `Conversion failed: ${error?.message || "Please try again."}` });
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <PdfToolPage
      title="Images to PDF"
      description="Turn photos, scans, and screenshots into a single PDF, one image per page. Runs in your browser; images never leave your device."
      stats={[
        { value: images.length || "-", label: "Pages" },
        { value: "PDF", label: "Output" },
      ]}
    >
      <PdfToolColumns
        main={
          <form onSubmit={handleConvert}>
            <FileDropzone
              accept="image/*"
              multiple
              disabled={isConverting}
              onFiles={addFiles}
              icon="fa-solid fa-images"
              title="Drag and drop images here"
              hint="JPG, PNG, WebP, GIF, or BMP. Add more any time."
            />

            {images.length ? (
              <ol className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {images.map((image, index) => (
                  <li
                    key={image.id}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 dark:border-slate-700 dark:bg-slate-900/80"
                  >
                    <div className="relative flex h-36 items-center justify-center bg-slate-100 dark:bg-slate-800">
                      <img
                        src={image.previewUrl}
                        alt={image.file.name}
                        className="max-h-full max-w-full object-contain"
                      />
                      <span className="absolute left-2 top-2 rounded-lg bg-slate-900/80 px-2 py-0.5 text-xs font-semibold text-white">
                        {index + 1}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 p-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
                          {image.file.name}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {formatBytes(image.file.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => moveImage(index, -1)}
                        disabled={isConverting || index === 0}
                        className={iconButtonClass}
                        aria-label={`Move ${image.file.name} earlier`}
                      >
                        <i className="fa-solid fa-arrow-left" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveImage(index, 1)}
                        disabled={isConverting || index === images.length - 1}
                        className={iconButtonClass}
                        aria-label={`Move ${image.file.name} later`}
                      >
                        <i className="fa-solid fa-arrow-right" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeImage(image.id)}
                        disabled={isConverting}
                        className={iconButtonClass}
                        aria-label={`Remove ${image.file.name}`}
                      >
                        <i className="fa-solid fa-xmark" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : null}

            <fieldset className="mt-5 grid gap-4 sm:grid-cols-3" disabled={isConverting}>
              <label className={fieldLabelClass}>
                Page size
                <select
                  value={pageSize}
                  onChange={(event) => setPageSize(event.target.value as PageSizeOption)}
                  className={`mt-2 ${inputClass}`}
                >
                  <option value="a4">A4</option>
                  <option value="letter">US Letter</option>
                  <option value="fit">Same as image</option>
                </select>
              </label>
              <label className={fieldLabelClass}>
                Orientation
                <select
                  value={orientation}
                  onChange={(event) => setOrientation(event.target.value as OrientationOption)}
                  disabled={pageSize === "fit"}
                  className={`mt-2 ${inputClass}`}
                >
                  <option value="auto">Auto (match image)</option>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label className={fieldLabelClass}>
                Margin
                <select
                  value={margin}
                  onChange={(event) => setMargin(Number(event.target.value))}
                  className={`mt-2 ${inputClass}`}
                >
                  {MARGINS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`sm:col-span-3 ${fieldLabelClass}`}>
                Output file name
                <input
                  type="text"
                  value={outputName}
                  onChange={(event) => setOutputName(event.target.value)}
                  className={`mt-2 ${inputClass}`}
                />
              </label>
            </fieldset>

            <StatusBanner status={status} />

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="submit" disabled={isConverting || !images.length} className={primaryButtonClass}>
                <i className={`fa-solid ${isConverting ? "fa-spinner fa-spin" : "fa-file-pdf"}`} />
                {isConverting ? "Converting..." : "Create PDF"}
              </button>
              <button
                type="button"
                onClick={clearImages}
                disabled={isConverting || !images.length}
                className={secondaryButtonClass}
              >
                <i className="fa-solid fa-trash" />
                Clear
              </button>
              <BackToPdfTools />
            </div>
          </form>
        }
        side={
          <>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Summary</h2>
            <SummaryList
              items={[
                { label: "Images", value: images.length },
                { label: "Total size", value: formatBytes(totalBytes) },
              ]}
            />
            <SideTips
              tips={[
                "Each image becomes one page, in the order shown.",
                "Large images are scaled down to fit the page; small ones are not enlarged.",
                "Phone photos are turned upright automatically.",
                "JPG and PNG are embedded as-is. Other formats are converted to PNG.",
              ]}
            />
          </>
        }
      />
    </PdfToolPage>
  );
}
