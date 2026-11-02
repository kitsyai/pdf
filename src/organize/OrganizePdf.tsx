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
  iconButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../shared/ToolLayout";
import { useRenderDocument, useThumbnails } from "../shared/useRenderDocument";
import { useSinglePdf } from "../shared/useSinglePdf";
import { organizePdf } from "./organizePdfCore";

function initialPages(count) {
  return Array.from({ length: count }, (_, source) => ({ source, rotation: 0 }));
}

export default function OrganizePdf() {
  const [pages, setPages] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState({
    tone: "info",
    text: "Add a PDF to reorder, rotate, or delete its pages.",
  });

  useEffect(() => {
    document.title = "Organize PDF Pages | Apps";
  }, []);

  const onError = useCallback((text) => setStatus({ tone: "error", text }), []);
  const onLoaded = useCallback(({ file, pageCount }) => {
    setPages(initialPages(pageCount));
    setStatus({
      tone: "success",
      text: `${file.name} loaded with ${pageCount} page${pageCount === 1 ? "" : "s"}. Drag pages to reorder.`,
    });
  }, []);
  const pdf = useSinglePdf({ onError, onLoaded });
  const { doc, error: renderError } = useRenderDocument(pdf.bytes);
  const thumbnails = useThumbnails(doc, 150);

  const changed = useMemo(
    () =>
      pages.length !== pdf.pageCount ||
      pages.some((page, index) => page.source !== index || page.rotation % 360 !== 0),
    [pages, pdf.pageCount]
  );
  const deleted = pdf.pageCount - pages.length;

  const clearFile = () => {
    pdf.clear();
    setPages([]);
  };

  const move = (from, to) => {
    setPages((current) => {
      if (to < 0 || to >= current.length || from === to) return current;
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const rotate = (index, delta) => {
    setPages((current) =>
      current.map((page, i) => (i === index ? { ...page, rotation: page.rotation + delta } : page))
    );
  };

  const rotateAll = (delta) => {
    setPages((current) => current.map((page) => ({ ...page, rotation: page.rotation + delta })));
  };

  const remove = (index) => {
    setPages((current) => current.filter((_, i) => i !== index));
  };

  const handleDrop = (event, index) => {
    event.preventDefault();
    if (dragIndex !== null) move(dragIndex, index);
    setDragIndex(null);
    setDropIndex(null);
  };

  const handleSave = async () => {
    if (!pdf.bytes || !pages.length) return;
    setIsSaving(true);
    setStatus({ tone: "info", text: "Saving your PDF..." });
    try {
      const bytes = await organizePdf(pdf.bytes, pages);
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      downloadBlob(blob, `${toBaseName(pdf.file.name, "document")}-organized.pdf`);
      setStatus({
        tone: "success",
        text: `Saved ${pages.length} page${pages.length === 1 ? "" : "s"} (${formatBytes(blob.size)}). Your download has started.`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: `Save failed: ${error?.message || "Please try again."}` });
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isSaving || pdf.isReading;

  return (
    <PdfToolPage
      title="Organize Pages"
      description="Reorder, rotate, and delete pages with thumbnail previews. Drag a page to move it. Runs in your browser; files never leave your device."
      stats={[
        { value: pages.length || "-", label: "Pages" },
        { value: deleted > 0 ? deleted : "-", label: "Deleted" },
      ]}
    >
      <PdfToolColumns
        main={
          <>
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

            {renderError ? (
              <p className="mt-3 text-xs text-rose-700 dark:text-rose-300">{renderError}</p>
            ) : null}

            {pages.length ? (
              <>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button type="button" onClick={() => rotateAll(-90)} disabled={busy} className={secondaryButtonClass}>
                    <i className="fa-solid fa-rotate-left" />
                    Rotate all left
                  </button>
                  <button type="button" onClick={() => rotateAll(90)} disabled={busy} className={secondaryButtonClass}>
                    <i className="fa-solid fa-rotate-right" />
                    Rotate all right
                  </button>
                  <button
                    type="button"
                    onClick={() => setPages((current) => [...current].reverse())}
                    disabled={busy}
                    className={secondaryButtonClass}
                  >
                    <i className="fa-solid fa-arrow-down-wide-short" />
                    Reverse order
                  </button>
                  <button
                    type="button"
                    onClick={() => setPages(initialPages(pdf.pageCount))}
                    disabled={busy || !changed}
                    className={secondaryButtonClass}
                  >
                    <i className="fa-solid fa-arrow-rotate-left" />
                    Reset
                  </button>
                </div>

                <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {pages.map((page, index) => {
                    const thumb = thumbnails[page.source];
                    return (
                      <li
                        key={page.source}
                        draggable={!busy}
                        onDragStart={(event) => {
                          setDragIndex(index);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setDropIndex(index);
                        }}
                        onDragLeave={() => setDropIndex((current) => (current === index ? null : current))}
                        onDrop={(event) => handleDrop(event, index)}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setDropIndex(null);
                        }}
                        className={`flex cursor-grab flex-col overflow-hidden rounded-2xl border bg-white/90 transition active:cursor-grabbing dark:bg-slate-900/80 ${
                          dropIndex === index && dragIndex !== index
                            ? "border-[#1F8CFF] ring-2 ring-[#1F8CFF]/40"
                            : "border-slate-200 dark:border-slate-700"
                        } ${dragIndex === index ? "opacity-40" : ""}`}
                      >
                        <div className="relative flex h-44 items-center justify-center overflow-hidden bg-slate-100 p-2 dark:bg-slate-800">
                          {thumb ? (
                            <img
                              src={thumb.url}
                              alt={`Page ${page.source + 1}`}
                              draggable={false}
                              className="max-h-full max-w-full shadow-sm transition-transform"
                              style={{ transform: `rotate(${page.rotation}deg)`, maxHeight: page.rotation % 180 ? "8.5rem" : undefined }}
                            />
                          ) : (
                            <i className="fa-solid fa-spinner fa-spin text-slate-400" aria-label="Rendering" />
                          )}
                          <span className="absolute left-2 top-2 rounded-lg bg-slate-900/80 px-2 py-0.5 text-xs font-semibold text-white">
                            {index + 1}
                          </span>
                          <span
                            data-source-page={page.source + 1}
                            className="absolute right-2 top-2 rounded-lg bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 shadow-sm dark:bg-slate-900/90 dark:text-slate-300"
                          >
                            p.{page.source + 1}
                          </span>
                        </div>
                        <div className="flex items-center justify-center p-2">
                          <div className="flex gap-1">
                            <button type="button" onClick={() => move(index, index - 1)} disabled={busy || index === 0} className={iconButtonClass} aria-label={`Move page ${page.source + 1} earlier`}>
                              <i className="fa-solid fa-arrow-left" />
                            </button>
                            <button type="button" onClick={() => move(index, index + 1)} disabled={busy || index === pages.length - 1} className={iconButtonClass} aria-label={`Move page ${page.source + 1} later`}>
                              <i className="fa-solid fa-arrow-right" />
                            </button>
                            <button type="button" onClick={() => rotate(index, 90)} disabled={busy} className={iconButtonClass} aria-label={`Rotate page ${page.source + 1}`}>
                              <i className="fa-solid fa-rotate-right" />
                            </button>
                            <button type="button" onClick={() => remove(index)} disabled={busy || pages.length === 1} className={iconButtonClass} aria-label={`Delete page ${page.source + 1}`}>
                              <i className="fa-solid fa-trash" />
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : null}

            <StatusBanner status={status} />

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={handleSave} disabled={busy || !pages.length || !changed} className={primaryButtonClass}>
                <i className={`fa-solid ${isSaving ? "fa-spinner fa-spin" : "fa-floppy-disk"}`} />
                {isSaving ? "Saving..." : "Save PDF"}
              </button>
              <BackToPdfTools />
            </div>
          </>
        }
        side={
          <>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Summary</h2>
            <SummaryList
              items={[
                { label: "Original pages", value: pdf.pageCount || "-" },
                { label: "Pages kept", value: pages.length || "-" },
                { label: "Pages deleted", value: pdf.pageCount ? deleted : "-" },
              ]}
            />
            <SideTips
              tips={[
                "Drag a page onto another to move it there, or use the arrows.",
                "Rotation is saved as part of the page, so every viewer shows it.",
                "Your original file is not changed; you download a new copy.",
              ]}
            />
          </>
        }
      />
    </PdfToolPage>
  );
}
