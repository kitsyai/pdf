import React, { useCallback, useEffect, useState } from "react";
import { downloadBlob, formatBytes, toBaseName } from "../shared/files";
import { parsePageSelection } from "../shared/pageRanges";
import { canvasToBlob, renderPageToCanvas } from "../shared/pdfRender";
import {
  BackToPdfTools,
  FileDropzone,
  PdfToolColumns,
  PdfToolPage,
  SelectedPdfCard,
  SideTips,
  StatusBanner,
  SummaryList,
  fieldLabelClass,
  inputClass,
  primaryButtonClass,
} from "../shared/ToolLayout";
import { useRenderDocument, useThumbnails } from "../shared/useRenderDocument";
import { useSinglePdf } from "../shared/useSinglePdf";
import { createZip } from "../shared/zip";
import { DPI_OPTIONS, IMAGE_FORMATS, dpiToScale, imageFileName, renderedSize, type ImageFormat } from "./pdfToImagesCore";

export default function PdfToImages() {
  const [format, setFormat] = useState<ImageFormat>("png");
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(0.85);
  const [pages, setPages] = useState("");
  const [isConverting, setIsConverting] = useState(false);
  const [status, setStatus] = useState({
    tone: "info",
    text: "Add a PDF to export its pages as PNG or JPG images.",
  });

  useEffect(() => {
    document.title = "PDF to Images | Apps";
  }, []);

  const onError = useCallback((text) => setStatus({ tone: "error", text }), []);
  const onLoaded = useCallback(({ file, pageCount }) => {
    setPages("");
    setStatus({
      tone: "success",
      text: `${file.name} loaded with ${pageCount} page${pageCount === 1 ? "" : "s"}.`,
    });
  }, []);
  const pdf = useSinglePdf({ onError, onLoaded });
  const { doc, error: renderError } = useRenderDocument(pdf.bytes);
  const thumbnails = useThumbnails(doc, 120);

  let selection = [];
  let selectionError = "";
  if (pdf.pageCount) {
    try {
      selection = [...new Set(parsePageSelection(pages, pdf.pageCount))];
    } catch (error) {
      selectionError = error.message;
    }
  }

  const firstPage = thumbnails[0];
  const estimate = firstPage ? renderedSize(firstPage.width, firstPage.height, dpi) : null;

  const handleConvert = async (event) => {
    event.preventDefault();
    if (!doc || !selection.length) return;

    setIsConverting(true);
    const baseName = toBaseName(pdf.file.name, "document");
    const { mime } = IMAGE_FORMATS[format];
    const outputs = [];
    let reduced = false;

    try {
      for (let i = 0; i < selection.length; i += 1) {
        const pageNumber = selection[i] + 1;
        setStatus({ tone: "info", text: `Rendering page ${pageNumber} (${i + 1} of ${selection.length})...` });
        const render = await renderPageToCanvas(doc, pageNumber, { scale: dpiToScale(dpi) });
        reduced = reduced || render.reduced;
        const blob = await canvasToBlob(render.canvas, mime, format === "jpeg" ? quality : undefined);
        render.canvas.width = 0;
        render.canvas.height = 0;
        outputs.push({
          name: imageFileName(baseName, pageNumber, pdf.pageCount, format),
          bytes: new Uint8Array(await blob.arrayBuffer()),
          type: mime,
        });
      }

      let size;
      if (outputs.length === 1) {
        const blob = new Blob([outputs[0].bytes as BlobPart], { type: outputs[0].type });
        size = blob.size;
        downloadBlob(blob, outputs[0].name);
      } else {
        const blob = new Blob([createZip(outputs) as BlobPart], { type: "application/zip" });
        size = blob.size;
        downloadBlob(blob, `${baseName}-images.zip`);
      }

      setStatus({
        tone: "success",
        text: `Exported ${outputs.length} image${outputs.length === 1 ? "" : "s"} (${formatBytes(size)}). Your download has started.${
          reduced ? " Some pages were scaled down to stay within browser canvas limits." : ""
        }`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: `Export failed: ${error?.message || "Please try again."}` });
    } finally {
      setIsConverting(false);
    }
  };

  const busy = isConverting || pdf.isReading;

  return (
    <PdfToolPage
      title="PDF to Images"
      description="Export PDF pages as PNG or JPG images at the resolution you need. Runs in your browser; files never leave your device."
      stats={[
        { value: pdf.pageCount || "-", label: "Pages" },
        { value: format === "png" ? "PNG" : "JPG", label: "Output" },
      ]}
    >
      <PdfToolColumns
        main={
          <form onSubmit={handleConvert}>
            {pdf.file ? (
              <SelectedPdfCard file={pdf.file} pageCount={pdf.pageCount} onRemove={pdf.clear} disabled={isConverting} />
            ) : (
              <FileDropzone
                accept=".pdf,application/pdf"
                disabled={busy}
                onFiles={pdf.selectFiles}
                title="Drag and drop a PDF here"
                hint="or click to browse from your device"
              />
            )}

            {renderError ? <p className="mt-3 text-xs text-rose-700 dark:text-rose-300">{renderError}</p> : null}

            {thumbnails.length ? (
              <div className="mt-5 flex gap-2 overflow-x-auto pb-2">
                {thumbnails.map((thumb, index) => (
                  <div
                    key={index}
                    className={`flex h-28 w-20 shrink-0 items-center justify-center rounded-lg border bg-slate-100 p-1 dark:bg-slate-800 ${
                      selection.includes(index) ? "border-[#1F8CFF]" : "border-slate-200 opacity-40 dark:border-slate-700"
                    }`}
                  >
                    {thumb ? (
                      <img src={thumb.url} alt={`Page ${index + 1}`} className="max-h-full max-w-full" />
                    ) : (
                      <i className="fa-solid fa-spinner fa-spin text-slate-400" />
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            <fieldset className="mt-5 grid gap-4 sm:grid-cols-2" disabled={busy || !pdf.pageCount}>
              <label className={fieldLabelClass}>
                Format
                <select value={format} onChange={(event) => setFormat(event.target.value as ImageFormat)} className={`mt-2 ${inputClass}`}>
                  {Object.entries(IMAGE_FORMATS).map(([value, option]) => (
                    <option key={value} value={value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={fieldLabelClass}>
                Resolution
                <select value={dpi} onChange={(event) => setDpi(Number(event.target.value))} className={`mt-2 ${inputClass}`}>
                  {DPI_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value} DPI{value === 72 ? " (screen)" : value === 150 ? " (recommended)" : value === 300 ? " (print)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {format === "jpeg" ? (
                <label className={fieldLabelClass}>
                  JPG quality: {Math.round(quality * 100)}%
                  <input
                    type="range"
                    min={0.4}
                    max={1}
                    step={0.05}
                    value={quality}
                    onChange={(event) => setQuality(Number(event.target.value))}
                    className="mt-2 w-full accent-[#1F8CFF]"
                  />
                </label>
              ) : null}
              <label className={fieldLabelClass}>
                Pages
                <input
                  type="text"
                  value={pages}
                  onChange={(event) => setPages(event.target.value)}
                  placeholder="All pages (e.g. 1-3, 5)"
                  className={`mt-2 ${inputClass}`}
                />
              </label>
            </fieldset>

            {selectionError && pages.trim() ? (
              <p className="mt-3 text-xs text-rose-700 dark:text-rose-300">{selectionError}</p>
            ) : null}

            <StatusBanner status={status} />

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="submit" disabled={busy || !doc || !selection.length} className={primaryButtonClass}>
                <i className={`fa-solid ${isConverting ? "fa-spinner fa-spin" : "fa-file-image"}`} />
                {isConverting ? "Exporting..." : "Export images"}
              </button>
              <BackToPdfTools />
            </div>
          </form>
        }
        side={
          <>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Output</h2>
            <SummaryList
              items={[
                { label: "Images", value: pdf.pageCount ? selection.length : "-" },
                {
                  label: "Page 1 size",
                  value: estimate ? `${estimate.width} × ${estimate.height}px` : "-",
                },
              ]}
            />
            <SideTips
              tips={[
                "150 DPI suits screens and sharing; use 300 DPI for printing.",
                "More than one image downloads as a ZIP.",
                "Very large pages are scaled down to fit browser limits.",
              ]}
            />
          </>
        }
      />
    </PdfToolPage>
  );
}
