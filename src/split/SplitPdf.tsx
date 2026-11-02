import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  cardClass,
  fieldLabelClass,
  inputClass,
  primaryButtonClass,
} from "../shared/ToolLayout";
import { useSinglePdf } from "../shared/useSinglePdf";
import { createZip } from "../shared/zip";
import { planSplit, splitPdf, type SplitMode } from "./splitPdfCore";

const MODES = [
  {
    id: "ranges",
    label: "By ranges",
    hint: "One PDF per range.",
  },
  {
    id: "every",
    label: "Every N pages",
    hint: "Equal chunks, e.g. every page.",
  },
  {
    id: "extract",
    label: "Extract pages",
    hint: "Selected pages into one PDF.",
  },
];

function describePages(indices) {
  const first = indices[0] + 1;
  const last = indices[indices.length - 1] + 1;
  if (indices.length === 1) return `Page ${first}`;
  const contiguous = indices.every((value, i) => i === 0 || value === indices[i - 1] + 1);
  return contiguous ? `Pages ${first}-${last}` : `${indices.length} pages`;
}

export default function SplitPdf() {
  const [mode, setMode] = useState<SplitMode>("ranges");
  const [ranges, setRanges] = useState("");
  const [every, setEvery] = useState("1");
  const [outputName, setOutputName] = useState("");
  const [isSplitting, setIsSplitting] = useState(false);
  const [status, setStatus] = useState({
    tone: "info",
    text: "Add a PDF, choose how to split it, and download the parts.",
  });

  useEffect(() => {
    document.title = "Split PDF | Apps";
  }, []);

  const onError = useCallback((text) => setStatus({ tone: "error", text }), []);
  const onLoaded = useCallback(({ file, pageCount }) => {
    setOutputName(toBaseName(file.name, "document"));
    setRanges("");
    setStatus({
      tone: "success",
      text: `${file.name} loaded with ${pageCount} page${pageCount === 1 ? "" : "s"}.`,
    });
  }, []);
  const pdf = useSinglePdf({ onError, onLoaded });

  const plan = useMemo(() => {
    if (!pdf.pageCount) return { groups: [], error: "" };
    try {
      return { groups: planSplit(pdf.pageCount, { mode, ranges, every: Number(every) }), error: "" };
    } catch (error) {
      return { groups: [], error: error.message };
    }
  }, [pdf.pageCount, mode, ranges, every]);

  const handleSplit = async (event) => {
    event.preventDefault();
    if (!pdf.bytes || !plan.groups.length) return;

    setIsSplitting(true);
    setStatus({ tone: "info", text: "Splitting your PDF..." });

    try {
      const baseName = toBaseName(outputName, "document");
      const outputs = await splitPdf(pdf.bytes, {
        mode,
        ranges,
        every: Number(every),
        baseName,
      });

      let blob;
      if (outputs.length === 1) {
        blob = new Blob([outputs[0].bytes as BlobPart], { type: "application/pdf" });
        downloadBlob(blob, outputs[0].name);
      } else {
        blob = new Blob([createZip(outputs) as BlobPart], { type: "application/zip" });
        downloadBlob(blob, `${baseName}-split.zip`);
      }

      setStatus({
        tone: "success",
        text:
          outputs.length === 1
            ? `Created ${outputs[0].name} (${formatBytes(blob.size)}). Your download has started.`
            : `Created ${outputs.length} PDFs in a ZIP (${formatBytes(blob.size)}). Your download has started.`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: `Split failed: ${error?.message || "Please try again."}` });
    } finally {
      setIsSplitting(false);
    }
  };

  const busy = isSplitting || pdf.isReading;
  const rangePlaceholder =
    pdf.pageCount > 1 ? `e.g. 1-${Math.ceil(pdf.pageCount / 2)}, ${Math.ceil(pdf.pageCount / 2) + 1}-` : "e.g. 1";

  return (
    <PdfToolPage
      title="Split PDF"
      description="Break a PDF into parts by page ranges or fixed chunks, or pull out just the pages you need. Runs in your browser; files never leave your device."
      stats={[
        { value: pdf.pageCount || "-", label: "Pages" },
        { value: plan.groups.length || "-", label: "Outputs" },
      ]}
    >
      <PdfToolColumns
        main={
          <form onSubmit={handleSplit}>
            {pdf.file ? (
              <SelectedPdfCard
                signed={pdf.signed}
                file={pdf.file}
                pageCount={pdf.pageCount}
                onRemove={pdf.clear}
                disabled={isSplitting}
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

            <fieldset className="mt-5" disabled={busy || !pdf.pageCount}>
              <legend className={fieldLabelClass}>Split mode</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {MODES.map((option) => (
                  <label
                    key={option.id}
                    className={`cursor-pointer rounded-xl border p-3 text-sm transition ${
                      mode === option.id
                        ? "border-[#1F8CFF] bg-blue-50 dark:bg-blue-500/10"
                        : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900"
                    }`}
                  >
                    <input
                      type="radio"
                      name="split-mode"
                      value={option.id}
                      checked={mode === option.id}
                      onChange={() => setMode(option.id as SplitMode)}
                      className="sr-only"
                    />
                    <span className="block font-semibold text-slate-900 dark:text-slate-100">
                      {option.label}
                    </span>
                    <span className="mt-1 block text-xs text-slate-600 dark:text-slate-300">
                      {option.hint}
                    </span>
                  </label>
                ))}
              </div>

              {mode === "every" ? (
                <label className={`mt-4 ${fieldLabelClass}`}>
                  Pages per file
                  <input
                    type="number"
                    min={1}
                    max={pdf.pageCount || undefined}
                    value={every}
                    onChange={(event) => setEvery(event.target.value)}
                    className={`mt-2 ${inputClass}`}
                  />
                </label>
              ) : (
                <label className={`mt-4 ${fieldLabelClass}`}>
                  {mode === "extract" ? "Pages to extract" : "Page ranges"}
                  <input
                    type="text"
                    value={ranges}
                    onChange={(event) => setRanges(event.target.value)}
                    placeholder={rangePlaceholder}
                    className={`mt-2 ${inputClass}`}
                  />
                </label>
              )}

              <label className={`mt-4 ${fieldLabelClass}`}>
                File name prefix
                <input
                  type="text"
                  value={outputName}
                  onChange={(event) => setOutputName(event.target.value)}
                  placeholder="document"
                  className={`mt-2 ${inputClass}`}
                />
              </label>
            </fieldset>

            {pdf.pageCount && plan.error && (ranges.trim() || mode === "every") ? (
              <p className="mt-3 text-xs text-rose-700 dark:text-rose-300">{plan.error}</p>
            ) : null}

            <StatusBanner status={status} />

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={busy || !plan.groups.length}
                className={primaryButtonClass}
              >
                <i className={`fa-solid ${isSplitting ? "fa-spinner fa-spin" : "fa-scissors"}`} />
                {isSplitting ? "Splitting..." : "Split PDF"}
              </button>
              <BackToPdfTools />
            </div>
          </form>
        }
        side={
          <>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Output</h2>
            {plan.groups.length ? (
              <ol className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
                {plan.groups.map((indices, index) => (
                  <li key={index} className={`${cardClass} !p-2.5 text-sm`}>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      File {index + 1}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {describePages(indices)}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <SummaryList
                items={[{ label: "Files to create", value: pdf.pageCount ? 0 : "-" }]}
              />
            )}
            <SideTips
              tips={[
                <>
                  Ranges: <code>1-3, 4-6</code> makes two files. <code>8-</code> means 8 to the end.
                </>,
                "More than one output downloads as a ZIP.",
                "Extract keeps pages in the order you type them.",
              ]}
            />
          </>
        }
      />
    </PdfToolPage>
  );
}
