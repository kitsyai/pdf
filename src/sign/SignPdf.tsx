import React, { useCallback, useEffect, useRef, useState } from "react";
import { downloadBlob, formatBytes, toBaseName } from "../shared/files";
import { canvasToBlob, renderPageToCanvas } from "../shared/pdfRender";
import {
  BackToPdfTools,
  FileDropzone,
  PdfToolColumns,
  PdfToolPage,
  SelectedPdfCard,
  SideTips,
  StatusBanner,
  cardClass,
  iconButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../shared/ToolLayout";
import { useRenderDocument } from "../shared/useRenderDocument";
import { useSinglePdf } from "../shared/useSinglePdf";
import SignatureCreator from "./SignatureCreator";
import { applySignatures } from "./signPdfCore";

const PREVIEW_WIDTH = 900;
let nextId = 0;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function usePagePreview(doc, pageIndex) {
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!doc) {
      setPreview(null);
      return undefined;
    }
    let cancelled = false;
    let url = null;
    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const render = await renderPageToCanvas(doc, pageIndex + 1, {
        scale: (PREVIEW_WIDTH / base.width) * ratio,
      });
      const blob = await canvasToBlob(render.canvas, "image/jpeg", 0.85);
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setPreview({ url, width: render.width, height: render.height });
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc, pageIndex]);

  return preview;
}

function PlacementBox({ placement, signature, pageAspect, selected, onSelect, onChange, onRemove, containerRef }) {
  const startDrag = (event, mode) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    const rect = containerRef.current.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY, placement };

    const handleMove = (moveEvent) => {
      const dx = (moveEvent.clientX - origin.x) / rect.width;
      const dy = (moveEvent.clientY - origin.y) / rect.height;
      const start = origin.placement;
      if (mode === "move") {
        onChange({
          x: clamp(start.x + dx, 0, 1 - start.width),
          y: clamp(start.y + dy, 0, 1 - start.height),
        });
      } else {
        // Keep the signature's own aspect ratio while resizing.
        const width = clamp(start.width + dx, 0.04, 1 - start.x);
        const height = (width * pageAspect) / signature.aspect;
        if (start.y + height <= 1) onChange({ width, height });
      }
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const nudge = (event) => {
    const step = event.shiftKey ? 0.02 : 0.005;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onRemove();
      return;
    }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    onChange({
      x: clamp(placement.x + move[0], 0, 1 - placement.width),
      y: clamp(placement.y + move[1], 0, 1 - placement.height),
    });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Placed signature. Drag to move, use arrow keys to nudge, Delete to remove."
      onPointerDown={(event) => startDrag(event, "move")}
      onKeyDown={nudge}
      onFocus={onSelect}
      className={`absolute cursor-move touch-none select-none outline-none ${
        selected ? "ring-2 ring-[#1F8CFF]" : "ring-1 ring-[#1F8CFF]/40 hover:ring-[#1F8CFF]"
      }`}
      style={{
        left: `${placement.x * 100}%`,
        top: `${placement.y * 100}%`,
        width: `${placement.width * 100}%`,
        height: `${placement.height * 100}%`,
      }}
    >
      <img src={signature.url} alt="" draggable={false} className="pointer-events-none h-full w-full" />
      {selected ? (
        <>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRemove}
            aria-label="Remove signature"
            className="absolute -right-3 -top-3 inline-flex h-6 w-6 items-center justify-center rounded-full bg-rose-600 text-[10px] text-white shadow"
          >
            <i className="fa-solid fa-xmark" />
          </button>
          <span
            onPointerDown={(event) => startDrag(event, "resize")}
            aria-hidden="true"
            className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-sm border-2 border-white bg-[#1F8CFF] shadow"
          />
        </>
      ) : null}
    </div>
  );
}

export default function SignPdf() {
  const [signatures, setSignatures] = useState([]);
  const [placements, setPlacements] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState({
    tone: "info",
    text: "Add a PDF, create your signature, then place it on the page.",
  });
  const containerRef = useRef(null);
  const signaturesRef = useRef(signatures);
  signaturesRef.current = signatures;

  useEffect(() => {
    document.title = "Sign PDF | Apps";
    return () => signaturesRef.current.forEach((signature) => URL.revokeObjectURL(signature.url));
  }, []);

  const onError = useCallback((text) => setStatus({ tone: "error", text }), []);
  const onLoaded = useCallback(({ file, pageCount }) => {
    setPlacements([]);
    setPageIndex(0);
    setStatus({
      tone: "success",
      text: `${file.name} loaded with ${pageCount} page${pageCount === 1 ? "" : "s"}. Create a signature to place it.`,
    });
  }, []);
  const pdf = useSinglePdf({ onError, onLoaded });
  const { doc, error: renderError } = useRenderDocument(pdf.bytes);
  const preview = usePagePreview(doc, pageIndex);
  const pageAspect = preview ? preview.width / preview.height : 1 / 1.414;

  const placeSignature = (signature, onPage = pageIndex) => {
    const width = 0.3;
    const height = Math.min((width * pageAspect) / signature.aspect, 1);
    // Step each new placement up and left so it does not hide an earlier one.
    const step = placements.filter((placement) => placement.pageIndex === onPage).length % 6;
    const placement = {
      id: `place-${++nextId}`,
      signatureId: signature.id,
      pageIndex: onPage,
      x: clamp(0.6 - width / 2 - step * 0.04, 0, 1 - width),
      y: clamp(0.8 - height / 2 - step * 0.08, 0, 1 - height),
      width,
      height,
    };
    setPlacements((current) => [...current, placement]);
    setSelectedId(placement.id);
  };

  const addSignature = (created) => {
    const signature = { id: `sig-${++nextId}`, ...created };
    setSignatures((current) => [...current, signature]);
    if (pdf.pageCount) {
      placeSignature(signature);
      setStatus({ tone: "success", text: "Signature placed. Drag it into position, or resize it from the corner." });
    }
  };

  const updatePlacement = (id, patch) => {
    setPlacements((current) => current.map((placement) => (placement.id === id ? { ...placement, ...patch } : placement)));
  };

  const removePlacement = (id) => {
    setPlacements((current) => current.filter((placement) => placement.id !== id));
    setSelectedId(null);
  };

  const removeSignature = (id) => {
    setSignatures((current) => {
      const removed = current.find((signature) => signature.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return current.filter((signature) => signature.id !== id);
    });
    setPlacements((current) => current.filter((placement) => placement.signatureId !== id));
  };

  const clearFile = () => {
    pdf.clear();
    setPlacements([]);
  };

  const handleSave = async () => {
    if (!pdf.bytes || !placements.length) return;
    setIsSaving(true);
    setStatus({ tone: "info", text: "Signing your PDF..." });
    try {
      const byId = new Map(signatures.map((signature) => [signature.id, signature]));
      const bytes = await applySignatures(
        pdf.bytes,
        placements.map((placement) => ({ ...placement, image: byId.get(placement.signatureId).bytes }))
      );
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      downloadBlob(blob, `${toBaseName(pdf.file.name, "document")}-signed.pdf`);
      setStatus({
        tone: "success",
        text: `Signed with ${placements.length} signature${placements.length === 1 ? "" : "s"} (${formatBytes(blob.size)}). Your download has started.`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: `Signing failed: ${error?.message || "Please try again."}` });
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isSaving || pdf.isReading;
  const pagePlacements = placements.filter((placement) => placement.pageIndex === pageIndex);
  const byId = new Map(signatures.map((signature) => [signature.id, signature]));

  return (
    <PdfToolPage
      title="Sign PDF"
      description="Draw, type, or upload your signature and place it anywhere on the page. Runs in your browser; your document and signature never leave your device."
      stats={[
        { value: pdf.pageCount || "-", label: "Pages" },
        { value: placements.length || "-", label: "Placed" },
      ]}
    >
      <PdfToolColumns
        main={
          <>
            {pdf.file ? (
              <SelectedPdfCard
                signed={pdf.signed} file={pdf.file} pageCount={pdf.pageCount} onRemove={clearFile} disabled={isSaving} />
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

            {pdf.pageCount ? (
              <div className="mt-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
                      disabled={pageIndex === 0}
                      className={iconButtonClass}
                      aria-label="Previous page"
                    >
                      <i className="fa-solid fa-chevron-left" />
                    </button>
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      Page {pageIndex + 1} of {pdf.pageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPageIndex((index) => Math.min(pdf.pageCount - 1, index + 1))}
                      disabled={pageIndex === pdf.pageCount - 1}
                      className={iconButtonClass}
                      aria-label="Next page"
                    >
                      <i className="fa-solid fa-chevron-right" />
                    </button>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {pagePlacements.length} on this page
                  </span>
                </div>

                <div className="flex justify-center rounded-2xl bg-slate-100 p-3 dark:bg-slate-800">
                  <div
                    ref={containerRef}
                    onPointerDown={() => setSelectedId(null)}
                    className="relative w-full max-w-[720px] bg-white shadow-md"
                    style={{ aspectRatio: preview ? `${preview.width} / ${preview.height}` : "1 / 1.414" }}
                  >
                    {preview ? (
                      <img
                        src={preview.url}
                        alt={`Page ${pageIndex + 1}`}
                        draggable={false}
                        className="pointer-events-none absolute inset-0 h-full w-full select-none"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <i className="fa-solid fa-spinner fa-spin text-slate-400" aria-label="Rendering page" />
                      </div>
                    )}
                    {pagePlacements.map((placement) => (
                      <PlacementBox
                        key={placement.id}
                        placement={placement}
                        signature={byId.get(placement.signatureId)}
                        pageAspect={pageAspect}
                        selected={selectedId === placement.id}
                        onSelect={() => setSelectedId(placement.id)}
                        onChange={(patch) => updatePlacement(placement.id, patch)}
                        onRemove={() => removePlacement(placement.id)}
                        containerRef={containerRef}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <StatusBanner status={status} />

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" onClick={handleSave} disabled={busy || !placements.length} className={primaryButtonClass}>
                <i className={`fa-solid ${isSaving ? "fa-spinner fa-spin" : "fa-signature"}`} />
                {isSaving ? "Signing..." : "Sign & Download"}
              </button>
              <BackToPdfTools />
            </div>
          </>
        }
        side={
          <>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Your signature</h2>
            <div className="mt-4">
              <SignatureCreator onCreate={addSignature} onError={onError} />
            </div>

            {signatures.length ? (
              <ul className="mt-5 space-y-2">
                {signatures.map((signature) => (
                  <li key={signature.id} className={`${cardClass} !p-2`}>
                    <div className="flex h-14 items-center justify-center rounded-lg bg-white">
                      <img src={signature.url} alt="Saved signature" className="max-h-full max-w-full" />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => placeSignature(signature)}
                        disabled={!pdf.pageCount}
                        className={`flex-1 justify-center ${secondaryButtonClass}`}
                      >
                        <i className="fa-solid fa-plus" />
                        Place
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSignature(signature.id)}
                        className={iconButtonClass}
                        aria-label="Delete signature"
                      >
                        <i className="fa-solid fa-trash" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            <SideTips
              tips={[
                "Place the same signature on several pages, or add initials with Type → Plain.",
                "Select a signature and press Delete to remove it; arrow keys nudge it.",
                "This adds a visible signature image. It is not a certificate-based digital signature.",
              ]}
            />
          </>
        }
      />
    </PdfToolPage>
  );
}
