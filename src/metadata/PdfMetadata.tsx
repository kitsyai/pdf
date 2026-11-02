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
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../shared/ToolLayout";
import { useSinglePdf } from "../shared/useSinglePdf";
import { METADATA_FIELDS, readPdfMetadata, writePdfMetadata } from "./pdfMetadataCore";

const FIELD_LABELS = {
  title: "Title",
  author: "Author",
  subject: "Subject",
  keywords: "Keywords",
  creator: "Creator (app that made it)",
  producer: "Producer (PDF library)",
};

const EMPTY_FIELDS = Object.fromEntries(METADATA_FIELDS.map((field) => [field, ""]));

function formatDate(date) {
  return date ? date.toLocaleString() : "Not set";
}

export default function PdfMetadata() {
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [info, setInfo] = useState(null);
  const [stripXmp, setStripXmp] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState({
    tone: "info",
    text: "Add a PDF to view and edit its title, author, subject, and keywords.",
  });

  useEffect(() => {
    document.title = "Edit PDF Metadata | Apps";
  }, []);

  const onError = useCallback((text) => setStatus({ tone: "error", text }), []);
  const onLoaded = useCallback(async ({ file, bytes }) => {
    try {
      const meta = await readPdfMetadata(bytes);
      setFields(Object.fromEntries(METADATA_FIELDS.map((field) => [field, meta[field]])));
      setInfo(meta);
      setStatus({ tone: "success", text: `${file.name} loaded. Edit the fields and save.` });
    } catch (error) {
      setStatus({ tone: "error", text: error?.message || "Could not read this PDF." });
    }
  }, []);
  const pdf = useSinglePdf({ onError, onLoaded });

  const clearFile = () => {
    pdf.clear();
    setInfo(null);
    setFields(EMPTY_FIELDS);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!pdf.bytes) return;

    setIsSaving(true);
    setStatus({ tone: "info", text: "Saving metadata..." });
    try {
      const bytes = await writePdfMetadata(pdf.bytes, fields, { stripXmp });
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      downloadBlob(blob, `${toBaseName(pdf.file.name, "document")}.pdf`);
      setStatus({
        tone: "success",
        text: `Saved (${formatBytes(blob.size)}). Your download has started.`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: `Save failed: ${error?.message || "Please try again."}` });
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isSaving || pdf.isReading;
  const ready = Boolean(pdf.bytes && info);

  return (
    <PdfToolPage
      title="Edit PDF Metadata"
      description="See and change the hidden document properties that viewers, search engines, and file managers show. Runs in your browser; files never leave your device."
      stats={[
        { value: pdf.pageCount || "-", label: "Pages" },
        { value: "PDF", label: "Output" },
      ]}
    >
      <PdfToolColumns
        main={
          <form onSubmit={handleSave}>
            {pdf.file ? (
              <SelectedPdfCard
                signed={pdf.signed}
                file={pdf.file}
                pageCount={pdf.pageCount}
                onRemove={clearFile}
                disabled={isSaving}
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

            <fieldset className="mt-5 grid gap-4 sm:grid-cols-2" disabled={busy || !ready}>
              {METADATA_FIELDS.map((field) => (
                <label
                  key={field}
                  className={`${field === "title" || field === "keywords" ? "sm:col-span-2" : ""} ${fieldLabelClass}`}
                >
                  {FIELD_LABELS[field]}
                  <input
                    type="text"
                    value={fields[field]}
                    onChange={(event) => setFields((current) => ({ ...current, [field]: event.target.value }))}
                    placeholder={field === "keywords" ? "Comma separated" : ""}
                    className={`mt-2 ${inputClass}`}
                  />
                </label>
              ))}

              <label className="flex items-start gap-3 text-sm text-slate-700 sm:col-span-2 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={stripXmp}
                  onChange={(event) => setStripXmp(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#1F8CFF]"
                />
                <span>
                  Remove the XMP copy of the metadata
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {info?.hasXmp
                      ? "This file has one. Some apps read it instead of the fields above, so removing it avoids showing old values."
                      : "This file has none."}
                  </span>
                </span>
              </label>
            </fieldset>

            <StatusBanner status={status} />

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="submit" disabled={busy || !ready} className={primaryButtonClass}>
                <i className={`fa-solid ${isSaving ? "fa-spinner fa-spin" : "fa-floppy-disk"}`} />
                {isSaving ? "Saving..." : "Save PDF"}
              </button>
              <button
                type="button"
                onClick={() => setFields(EMPTY_FIELDS)}
                disabled={busy || !ready}
                className={secondaryButtonClass}
              >
                <i className="fa-solid fa-eraser" />
                Clear all fields
              </button>
              <BackToPdfTools />
            </div>
          </form>
        }
        side={
          <>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">File info</h2>
            <SummaryList
              items={[
                { label: "Pages", value: info?.pageCount ?? "-" },
                { label: "Created", value: info ? formatDate(info.creationDate) : "-" },
                { label: "Modified", value: info ? formatDate(info.modificationDate) : "-" },
              ]}
            />
            <SideTips
              tips={[
                "Clear all fields before sharing a file to remove names and app details.",
                "Saving updates the modified date. Page content is not changed.",
              ]}
            />
          </>
        }
      />
    </PdfToolPage>
  );
}
