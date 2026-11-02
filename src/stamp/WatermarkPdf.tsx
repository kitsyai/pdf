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
  cardClass,
  fieldLabelClass,
  inputClass,
  primaryButtonClass,
} from "../shared/ToolLayout";
import { useSinglePdf } from "../shared/useSinglePdf";
import { formatPageNumber, stampPdf, type NumberPosition } from "./stampPdfCore";

const NUMBER_FORMATS = ["{n}", "Page {n}", "Page {n} of {total}", "{n} / {total}"];

const POSITIONS = [
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "top-center", label: "Top center" },
  { value: "top-right", label: "Top right" },
  { value: "top-left", label: "Top left" },
];

function Toggle({ checked, onChange, label, disabled = false }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="h-4 w-4 accent-[#1F8CFF]"
      />
      {label}
    </label>
  );
}

function StampPreview({ watermark, pageNumbers }) {
  const [vertical, horizontal] = (pageNumbers?.position || "bottom-center").split("-");
  const justify = { left: "justify-start", center: "justify-center", right: "justify-end" }[horizontal];

  return (
    <div className="mx-auto mt-4 flex aspect-[1/1.414] w-40 flex-col overflow-hidden rounded-md border border-slate-300 bg-white p-2 shadow-sm">
      {pageNumbers && vertical === "top" ? (
        <div className={`flex ${justify} text-[7px] text-slate-600`}>
          {formatPageNumber(pageNumbers.format, 1, 12)}
        </div>
      ) : null}
      <div className="relative flex flex-1 items-center justify-center">
        <div className="absolute inset-x-1 top-2 space-y-1">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="h-1 rounded bg-slate-200" style={{ width: `${70 + ((i * 17) % 30)}%` }} />
          ))}
        </div>
        {watermark ? (
          <span
            className="relative whitespace-nowrap font-bold"
            style={{
              color: watermark.color,
              opacity: watermark.opacity,
              fontSize: `${Math.max(6, watermark.fontSize / 4)}px`,
              transform: `rotate(${-watermark.rotation}deg)`,
            }}
          >
            {watermark.text}
          </span>
        ) : null}
      </div>
      {pageNumbers && vertical === "bottom" ? (
        <div className={`flex ${justify} text-[7px] text-slate-600`}>
          {formatPageNumber(pageNumbers.format, 1, 12)}
        </div>
      ) : null}
    </div>
  );
}

export default function WatermarkPdf() {
  const [useWatermark, setUseWatermark] = useState(true);
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");
  const [watermarkSize, setWatermarkSize] = useState(60);
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.2);
  const [watermarkRotation, setWatermarkRotation] = useState(45);
  const [watermarkColor, setWatermarkColor] = useState("#e11d48");
  const [useNumbers, setUseNumbers] = useState(false);
  const [numberFormat, setNumberFormat] = useState("Page {n} of {total}");
  const [numberPosition, setNumberPosition] = useState<NumberPosition>("bottom-center");
  const [numberSize, setNumberSize] = useState(11);
  const [startAt, setStartAt] = useState(1);
  const [pages, setPages] = useState("");
  const [outputName, setOutputName] = useState("");
  const [isStamping, setIsStamping] = useState(false);
  const [status, setStatus] = useState({
    tone: "info",
    text: "Add a PDF, then stamp a text watermark, page numbers, or both.",
  });

  useEffect(() => {
    document.title = "Watermark & Page Numbers | Apps";
  }, []);

  const onError = useCallback((text) => setStatus({ tone: "error", text }), []);
  const onLoaded = useCallback(({ file, pageCount }) => {
    setOutputName(`${toBaseName(file.name, "document")}-stamped`);
    setStatus({
      tone: "success",
      text: `${file.name} loaded with ${pageCount} page${pageCount === 1 ? "" : "s"}.`,
    });
  }, []);
  const pdf = useSinglePdf({ onError, onLoaded });

  const watermark = useWatermark
    ? {
        text: watermarkText,
        fontSize: Number(watermarkSize),
        opacity: Number(watermarkOpacity),
        rotation: Number(watermarkRotation),
        color: watermarkColor,
      }
    : null;
  const pageNumbers = useNumbers
    ? {
        format: numberFormat,
        position: numberPosition,
        fontSize: Number(numberSize),
        startAt: Number(startAt),
      }
    : null;
  const hasStamp = Boolean((watermark && watermarkText.trim()) || pageNumbers);

  const handleStamp = async (event) => {
    event.preventDefault();
    if (!pdf.bytes || !hasStamp) return;

    setIsStamping(true);
    setStatus({ tone: "info", text: "Stamping your PDF..." });
    try {
      const bytes = await stampPdf(pdf.bytes, { pages, watermark, pageNumbers });
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      downloadBlob(blob, `${toBaseName(outputName, "stamped")}.pdf`);
      setStatus({
        tone: "success",
        text: `Done (${formatBytes(blob.size)}). Your download has started.`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: `Stamping failed: ${error?.message || "Please try again."}` });
    } finally {
      setIsStamping(false);
    }
  };

  const busy = isStamping || pdf.isReading;

  return (
    <PdfToolPage
      title="Watermark & Page Numbers"
      description="Stamp a text watermark such as DRAFT or CONFIDENTIAL, and add page numbers, on every page or just the ones you pick. Runs in your browser."
      stats={[
        { value: pdf.pageCount || "-", label: "Pages" },
        { value: "PDF", label: "Output" },
      ]}
    >
      <PdfToolColumns
        main={
          <form onSubmit={handleStamp}>
            {pdf.file ? (
              <SelectedPdfCard
                signed={pdf.signed}
                file={pdf.file}
                pageCount={pdf.pageCount}
                onRemove={pdf.clear}
                disabled={isStamping}
              />
            ) : (
              <FileDropzone
                accept=".pdf,application/pdf"
                disabled={busy}
                onFiles={pdf.selectFiles}
                title="Drag and drop a PDF here"
                hint="or click to browse from your device"
              />
            )}

            <fieldset className="mt-5 space-y-4" disabled={busy}>
              <div className={cardClass}>
                <Toggle checked={useWatermark} onChange={setUseWatermark} label="Text watermark" />
                {useWatermark ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className={`sm:col-span-2 ${fieldLabelClass}`}>
                      Text
                      <input
                        type="text"
                        value={watermarkText}
                        onChange={(event) => setWatermarkText(event.target.value)}
                        maxLength={80}
                        className={`mt-2 ${inputClass}`}
                      />
                    </label>
                    <label className={fieldLabelClass}>
                      Size: {watermarkSize}pt
                      <input
                        type="range"
                        min={12}
                        max={160}
                        value={watermarkSize}
                        onChange={(event) => setWatermarkSize(Number(event.target.value))}
                        className="mt-2 w-full accent-[#1F8CFF]"
                      />
                    </label>
                    <label className={fieldLabelClass}>
                      Opacity: {Math.round(watermarkOpacity * 100)}%
                      <input
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.05}
                        value={watermarkOpacity}
                        onChange={(event) => setWatermarkOpacity(Number(event.target.value))}
                        className="mt-2 w-full accent-[#1F8CFF]"
                      />
                    </label>
                    <label className={fieldLabelClass}>
                      Angle
                      <select
                        value={watermarkRotation}
                        onChange={(event) => setWatermarkRotation(Number(event.target.value))}
                        className={`mt-2 ${inputClass}`}
                      >
                        <option value={0}>Horizontal</option>
                        <option value={45}>Diagonal (45°)</option>
                        <option value={-45}>Diagonal (-45°)</option>
                        <option value={90}>Vertical</option>
                      </select>
                    </label>
                    <label className={fieldLabelClass}>
                      Colour
                      <input
                        type="color"
                        value={watermarkColor}
                        onChange={(event) => setWatermarkColor(event.target.value)}
                        className="mt-2 h-9 w-full cursor-pointer rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950"
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              <div className={cardClass}>
                <Toggle checked={useNumbers} onChange={setUseNumbers} label="Page numbers" />
                {useNumbers ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className={fieldLabelClass}>
                      Format
                      <select
                        value={numberFormat}
                        onChange={(event) => setNumberFormat(event.target.value)}
                        className={`mt-2 ${inputClass}`}
                      >
                        {NUMBER_FORMATS.map((format) => (
                          <option key={format} value={format}>
                            {formatPageNumber(format, 1, 12)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={fieldLabelClass}>
                      Position
                      <select
                        value={numberPosition}
                        onChange={(event) => setNumberPosition(event.target.value as NumberPosition)}
                        className={`mt-2 ${inputClass}`}
                      >
                        {POSITIONS.map((position) => (
                          <option key={position.value} value={position.value}>
                            {position.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={fieldLabelClass}>
                      Font size
                      <input
                        type="number"
                        min={6}
                        max={36}
                        value={numberSize}
                        onChange={(event) => setNumberSize(Number(event.target.value))}
                        className={`mt-2 ${inputClass}`}
                      />
                    </label>
                    <label className={fieldLabelClass}>
                      Start numbering at
                      <input
                        type="number"
                        min={1}
                        value={startAt}
                        onChange={(event) => setStartAt(Number(event.target.value))}
                        className={`mt-2 ${inputClass}`}
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className={fieldLabelClass}>
                  Apply to pages
                  <input
                    type="text"
                    value={pages}
                    onChange={(event) => setPages(event.target.value)}
                    placeholder="All pages (e.g. 2-)"
                    className={`mt-2 ${inputClass}`}
                  />
                </label>
                <label className={fieldLabelClass}>
                  Output file name
                  <input
                    type="text"
                    value={outputName}
                    onChange={(event) => setOutputName(event.target.value)}
                    placeholder="stamped"
                    className={`mt-2 ${inputClass}`}
                  />
                </label>
              </div>
            </fieldset>

            <StatusBanner status={status} />

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={busy || !pdf.bytes || !hasStamp}
                className={primaryButtonClass}
              >
                <i className={`fa-solid ${isStamping ? "fa-spinner fa-spin" : "fa-stamp"}`} />
                {isStamping ? "Stamping..." : "Apply & Download"}
              </button>
              <BackToPdfTools />
            </div>
          </form>
        }
        side={
          <>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Preview</h2>
            <StampPreview watermark={watermark} pageNumbers={pageNumbers} />
            <SideTips
              tips={[
                "The preview is a rough guide to placement, not an exact render.",
                <>
                  Skip a cover page with <code>2-</code> in Apply to pages. Numbering counts only
                  stamped pages.
                </>,
                "Text uses Helvetica, so it supports basic Latin characters only.",
              ]}
            />
          </>
        }
      />
    </PdfToolPage>
  );
}
