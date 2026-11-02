import React, { useEffect, useMemo, useState } from "react";
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
import { getPdfPageCount, isPdfFile, mergePdfs } from "./mergePdfCore";

const MAX_FILES = 20;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

let nextEntryId = 0;

export default function MergePdf() {
  const [entries, setEntries] = useState([]);
  const [outputName, setOutputName] = useState("merged");
  const [isMerging, setIsMerging] = useState(false);
  const [status, setStatus] = useState({
    tone: "info",
    text: "Add PDF files, arrange them in order, and merge into one document.",
  });

  useEffect(() => {
    document.title = "Merge PDF | Apps";
  }, []);

  const totalBytes = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.file.size, 0),
    [entries]
  );

  const totalPages = useMemo(
    () => entries.reduce((sum, entry) => sum + (entry.pageCount || 0), 0),
    [entries]
  );

  const readyEntries = useMemo(
    () => entries.filter((entry) => entry.state === "ready"),
    [entries]
  );

  const updateEntry = (id, patch) => {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
    );
  };

  const inspectEntry = async (entry) => {
    try {
      const bytes = await entry.file.arrayBuffer();
      const pageCount = await getPdfPageCount(bytes);
      updateEntry(entry.id, { bytes, pageCount, state: "ready", error: "" });
    } catch (error) {
      updateEntry(entry.id, {
        state: "error",
        error: error?.message || "Could not read this PDF.",
      });
    }
  };

  const addFiles = (nextFiles) => {
    if (!nextFiles.length) return;

    const pdfOnly = nextFiles.filter(isPdfFile);
    if (!pdfOnly.length) {
      setStatus({ tone: "error", text: "Only PDF files are supported." });
      return;
    }

    if (entries.length + pdfOnly.length > MAX_FILES) {
      setStatus({
        tone: "error",
        text: `Please merge up to ${MAX_FILES} PDF files at a time.`,
      });
      return;
    }

    const incomingBytes = pdfOnly.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes + incomingBytes > MAX_TOTAL_BYTES) {
      setStatus({
        tone: "error",
        text: `Total size must stay under ${formatBytes(MAX_TOTAL_BYTES)}.`,
      });
      return;
    }

    const newEntries = pdfOnly.map((file) => ({
      id: `pdf-${++nextEntryId}`,
      file,
      bytes: null,
      pageCount: 0,
      pages: "",
      state: "loading",
      error: "",
    }));

    setEntries((current) => [...current, ...newEntries]);
    newEntries.forEach(inspectEntry);

    const skipped = nextFiles.length - pdfOnly.length;
    setStatus({
      tone: "success",
      text: `${pdfOnly.length} PDF file${pdfOnly.length > 1 ? "s" : ""} added.${
        skipped ? ` ${skipped} non-PDF file${skipped > 1 ? "s" : ""} skipped.` : ""
      }`,
    });
  };

  const moveEntry = (index, offset) => {
    setEntries((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeEntry = (id) => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
  };

  const clearSelection = () => {
    setEntries([]);
    setStatus({
      tone: "info",
      text: "Selection cleared. Add PDF files to continue.",
    });
  };

  const handleMerge = async (event) => {
    event.preventDefault();
    if (!readyEntries.length) {
      setStatus({
        tone: "error",
        text: "Please add at least one readable PDF before merging.",
      });
      return;
    }

    if (entries.some((entry) => entry.state === "loading")) {
      setStatus({ tone: "info", text: "Still reading files. Please try again in a moment." });
      return;
    }

    setIsMerging(true);
    setStatus({ tone: "info", text: "Merging your PDF files..." });

    try {
      const baseName = toBaseName(outputName, "merged");
      const mergedBytes = await mergePdfs(
        readyEntries.map((entry) => ({
          name: entry.file.name,
          bytes: entry.bytes,
          pages: entry.pages,
        })),
        { title: baseName }
      );

      const blob = new Blob([mergedBytes as BlobPart], { type: "application/pdf" });
      downloadBlob(blob, `${baseName}.pdf`);

      const skipped = entries.length - readyEntries.length;
      setStatus({
        tone: "success",
        text: `Merged ${readyEntries.length} file${readyEntries.length > 1 ? "s" : ""} (${formatBytes(
          blob.size
        )}). Your download has started.${
          skipped ? ` ${skipped} unreadable file${skipped > 1 ? "s were" : " was"} skipped.` : ""
        }`,
      });
    } catch (error) {
      setStatus({
        tone: "error",
        text: `Merge failed: ${error?.message || "Please try again."}`,
      });
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <PdfToolPage
      title="Merge PDF"
      description="Combine multiple PDFs into one file. Reorder files, pick page ranges, and download. Everything runs in your browser; files never leave your device."
      stats={[
        { value: MAX_FILES, label: "Max Files" },
        { value: "PDF", label: "Output" },
      ]}
    >
      <PdfToolColumns
        main={
          <form onSubmit={handleMerge}>
            <FileDropzone
              accept=".pdf,application/pdf"
              multiple
              disabled={isMerging}
              onFiles={addFiles}
              title="Drag and drop PDF files here"
              hint="or click to browse. Add more any time; they are appended to the list."
            />

            {entries.length ? (
              <ol className="mt-5 space-y-3">
                {entries.map((entry, index) => (
                  <li
                    key={entry.id}
                    className={`rounded-2xl border p-3 sm:p-4 ${
                      entry.state === "error"
                        ? "border-rose-200 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10"
                        : "border-slate-200 bg-white/90 dark:border-slate-700 dark:bg-slate-900/80"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {entry.file.name}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {formatBytes(entry.file.size)}
                          {entry.state === "ready"
                            ? ` · ${entry.pageCount} page${entry.pageCount === 1 ? "" : "s"}`
                            : null}
                          {entry.state === "loading" ? " · reading..." : null}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => moveEntry(index, -1)}
                          disabled={isMerging || index === 0}
                          className={iconButtonClass}
                          aria-label={`Move ${entry.file.name} up`}
                        >
                          <i className="fa-solid fa-arrow-up" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveEntry(index, 1)}
                          disabled={isMerging || index === entries.length - 1}
                          className={iconButtonClass}
                          aria-label={`Move ${entry.file.name} down`}
                        >
                          <i className="fa-solid fa-arrow-down" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeEntry(entry.id)}
                          disabled={isMerging}
                          className={iconButtonClass}
                          aria-label={`Remove ${entry.file.name}`}
                        >
                          <i className="fa-solid fa-xmark" />
                        </button>
                      </div>
                    </div>

                    {entry.state === "error" ? (
                      <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">
                        {entry.error} This file will be skipped.
                      </p>
                    ) : null}

                    {entry.state === "ready" && entry.pageCount > 1 ? (
                      <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <span className="font-semibold uppercase tracking-[0.12em]">Pages</span>
                        <input
                          type="text"
                          value={entry.pages}
                          onChange={(event) => updateEntry(entry.id, { pages: event.target.value })}
                          disabled={isMerging}
                          placeholder={`All pages (e.g. 1-${entry.pageCount}, or ${entry.pageCount}-1 to reverse)`}
                          className={`flex-1 ${inputClass}`}
                        />
                      </label>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}

            <label className={`mt-5 ${fieldLabelClass}`}>
              Output file name
              <div className="mt-2 flex items-center rounded-xl border border-slate-300 bg-white focus-within:border-[#1F8CFF] dark:border-slate-700 dark:bg-slate-950">
                <input
                  type="text"
                  value={outputName}
                  onChange={(event) => setOutputName(event.target.value)}
                  disabled={isMerging}
                  className="min-w-0 flex-1 rounded-xl bg-transparent px-3 py-2 text-sm normal-case tracking-normal text-slate-900 outline-none dark:text-slate-100"
                />
                <span className="px-3 text-sm normal-case tracking-normal text-slate-500">.pdf</span>
              </div>
            </label>

            <StatusBanner status={status} />

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={isMerging || !readyEntries.length}
                className={primaryButtonClass}
              >
                <i className={`fa-solid ${isMerging ? "fa-spinner fa-spin" : "fa-object-group"}`} />
                {isMerging ? "Merging..." : "Merge PDFs"}
              </button>

              <button
                type="button"
                onClick={clearSelection}
                disabled={isMerging || !entries.length}
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
                { label: "Files", value: entries.length },
                { label: "Total pages", value: totalPages },
                { label: "Total size", value: formatBytes(totalBytes) },
              ]}
            />
            <SideTips
              tips={[
                "Files are merged top to bottom. Use the arrows to reorder.",
                <>
                  Page ranges are 1-based: <code>1-3, 5, 8-</code>. <code>5-1</code> reverses.
                </>,
                "Password-protected PDFs are skipped.",
              ]}
            />
          </>
        }
      />
    </PdfToolPage>
  );
}
