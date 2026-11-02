import React, { useCallback, useEffect, useState } from "react";
import { downloadBlob, formatBytes, toBaseName } from "../shared/files";
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
  primaryButtonClass,
} from "../shared/ToolLayout";
import { useSinglePdf } from "../shared/useSinglePdf";
import { browserCodec } from "./browserCodec";
import { COMPRESSION_LEVELS, compressPdf } from "./compressPdfCore";

const LEVEL_HINTS = {
  light: "Barely visible change. Best for print.",
  balanced: "Good for email and sharing.",
  strong: "Smallest file. Photos look softer.",
};

export default function CompressPdf() {
  const [level, setLevel] = useState("balanced");
  const [result, setResult] = useState(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [status, setStatus] = useState({
    tone: "info",
    text: "Add a PDF to shrink it by re-compressing its images.",
  });

  useEffect(() => {
    document.title = "Compress PDF | Apps";
  }, []);

  const onError = useCallback((text) => setStatus({ tone: "error", text }), []);
  const onLoaded = useCallback(({ file }) => {
    setResult(null);
    setStatus({ tone: "success", text: `${file.name} loaded (${formatBytes(file.size)}). Choose a level and compress.` });
  }, []);
  const pdf = useSinglePdf({ onError, onLoaded });

  const clearFile = () => {
    pdf.clear();
    setResult(null);
  };

  const handleCompress = async (event) => {
    event.preventDefault();
    if (!pdf.bytes) return;

    setIsCompressing(true);
    setResult(null);
    try {
      const { bytes, stats } = await compressPdf(pdf.bytes, COMPRESSION_LEVELS[level], browserCodec, (done, total) =>
        setStatus({ tone: "info", text: total ? `Compressing images (${done} of ${total})...` : "Optimizing..." })
      );
      setResult(stats);

      if (stats.newSize < stats.originalSize * 0.98) {
        const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
        downloadBlob(blob, `${toBaseName(pdf.file.name, "document")}-compressed.pdf`);
        const saved = Math.round((1 - stats.newSize / stats.originalSize) * 100);
        setStatus({
          tone: "success",
          text: `${formatBytes(stats.originalSize)} → ${formatBytes(stats.newSize)} (${saved}% smaller). Your download has started.`,
        });
      } else {
        setStatus({
          tone: "info",
          text: stats.images
            ? "This PDF is already well optimized; a smaller version could not be made at this level. Try Strong, or keep your original."
            : "This PDF has no images to compress, so it cannot be made noticeably smaller. Text and vector content is already compact.",
        });
      }
    } catch (error) {
      setStatus({ tone: "error", text: `Compression failed: ${error?.message || "Please try again."}` });
    } finally {
      setIsCompressing(false);
    }
  };

  const busy = isCompressing || pdf.isReading;

  return (
    <PdfToolPage
      title="Compress PDF"
      description="Shrink PDFs that are heavy with photos or scans by re-compressing their images. Runs in your browser; files never leave your device."
      stats={[
        { value: pdf.file ? formatBytes(pdf.file.size) : "-", label: "Original" },
        { value: result ? formatBytes(result.newSize) : "-", label: "Result" },
      ]}
    >
      <PdfToolColumns
        main={
          <form onSubmit={handleCompress}>
            {pdf.file ? (
              <SelectedPdfCard
                signed={pdf.signed} file={pdf.file} pageCount={pdf.pageCount} onRemove={clearFile} disabled={isCompressing} />
            ) : (
              <FileDropzone
                accept=".pdf,application/pdf"
                disabled={busy}
                onFiles={pdf.selectFiles}
                title="Drag and drop a PDF here"
                hint="or click to browse from your device"
              />
            )}

            <fieldset className="mt-5" disabled={busy || !pdf.bytes}>
              <legend className={fieldLabelClass}>Compression level</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {Object.entries(COMPRESSION_LEVELS).map(([id, option]) => (
                  <label
                    key={id}
                    className={`cursor-pointer rounded-xl border p-3 text-sm transition ${
                      level === id
                        ? "border-[#1F8CFF] bg-blue-50 dark:bg-blue-500/10"
                        : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900"
                    }`}
                  >
                    <input
                      type="radio"
                      name="compression-level"
                      value={id}
                      checked={level === id}
                      onChange={() => setLevel(id)}
                      className="sr-only"
                    />
                    <span className="block font-semibold text-slate-900 dark:text-slate-100">{option.label}</span>
                    <span className="mt-1 block text-xs text-slate-600 dark:text-slate-300">{LEVEL_HINTS[id]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <StatusBanner status={status} />

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="submit" disabled={busy || !pdf.bytes} className={primaryButtonClass}>
                <i className={`fa-solid ${isCompressing ? "fa-spinner fa-spin" : "fa-file-zipper"}`} />
                {isCompressing ? "Compressing..." : "Compress PDF"}
              </button>
              <BackToPdfTools />
            </div>
          </form>
        }
        side={
          <>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Result</h2>
            <SummaryList
              items={[
                { label: "Images found", value: result ? result.images : "-" },
                { label: "Images compressed", value: result ? result.compressed : "-" },
                { label: "New size", value: result ? formatBytes(result.newSize) : "-" },
              ]}
            />
            <SideTips
              tips={[
                "Works best on scans and photo-heavy PDFs.",
                "Text stays sharp: only images are re-compressed.",
                "Masks and CMYK images are left as they are.",
              ]}
            />
          </>
        }
      />
    </PdfToolPage>
  );
}
