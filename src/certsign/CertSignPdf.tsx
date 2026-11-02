import React, { useCallback, useEffect, useRef, useState } from "react";
import { downloadBlob, formatBytes, toBaseName } from "../shared/files";
import { PasswordInput } from "../shared/PasswordInput";
import { openRenderDocument, renderThumbnail } from "../shared/pdfRender";
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
  secondaryButtonClass,
} from "../shared/ToolLayout";
import { useSinglePdf } from "../shared/useSinglePdf";
import { describeCertificate, webCryptoSigner } from "./cms";
import { signPdfWithCertificate } from "./padesCore";
import { CertificatePasswordError, readPkcs12 } from "./pkcs12";
import { verifyPdfSignatures } from "./verifyCore";

const REASONS = [
  "I am the author of this document",
  "I approve this document",
  "I have reviewed this document",
  "I agree to the terms of this document",
];

const BOX = { width: 0.38, height: 0.09 };
const POSITIONS = {
  "bottom-right": { x: 0.98 - BOX.width, y: 0.97 - BOX.height, label: "Bottom right" },
  "bottom-left": { x: 0.02, y: 0.97 - BOX.height, label: "Bottom left" },
  "top-right": { x: 0.98 - BOX.width, y: 0.03, label: "Top right" },
  "top-left": { x: 0.02, y: 0.03, label: "Top left" },
};

const formatDate = (date: Date) =>
  date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function usePagePreview(bytes, pageIndex) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!bytes) {
      setPreview(null);
      return undefined;
    }
    let cancelled = false;
    let url = null;
    let doc = null;
    (async () => {
      doc = await openRenderDocument(bytes);
      const thumb = await renderThumbnail(doc, pageIndex + 1, 220);
      url = thumb.url;
      if (cancelled) URL.revokeObjectURL(url);
      else setPreview(thumb);
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      doc?.destroy();
    };
  }, [bytes, pageIndex]);
  return preview;
}

export default function CertSignPdf() {
  const certInputRef = useRef(null);
  const [certFile, setCertFile] = useState(null);
  const [certPassword, setCertPassword] = useState("");
  const [signer, setSigner] = useState(null);
  const [certificate, setCertificate] = useState(null);
  const [reason, setReason] = useState(REASONS[1]);
  const [customReason, setCustomReason] = useState("");
  const [location, setLocation] = useState("");
  const [visible, setVisible] = useState(true);
  const [pageIndex, setPageIndex] = useState(0);
  const [position, setPosition] = useState("bottom-right");
  const [isWorking, setIsWorking] = useState(false);
  const [status, setStatus] = useState({
    tone: "info",
    text: "Add a PDF and your certificate (.pfx or .p12) to sign it digitally.",
  });

  useEffect(() => {
    document.title = "Digital Signature (Certificate) | Apps";
  }, []);

  const onError = useCallback((text) => setStatus({ tone: "error", text }), []);
  const onLoaded = useCallback(({ file, pageCount }) => {
    setPageIndex(Math.max(0, pageCount - 1));
    setStatus({ tone: "success", text: `${file.name} loaded. Now open your certificate.` });
  }, []);
  const pdf = useSinglePdf({ onError, onLoaded });
  const preview = usePagePreview(visible ? pdf.bytes : null, pageIndex);

  const forgetCertificate = () => {
    setSigner(null);
    setCertificate(null);
    setCertPassword("");
  };

  const chooseCertificate = (file) => {
    if (!file) return;
    forgetCertificate();
    setCertFile(file);
  };

  const openCertificate = async () => {
    if (!certFile) return;
    setIsWorking(true);
    try {
      const identity = readPkcs12(new Uint8Array(await certFile.arrayBuffer()), certPassword);
      const summary = describeCertificate(identity.certificate);
      // The key is imported as non-extractable; drop our copy of its bytes.
      const nextSigner = await webCryptoSigner(identity);
      identity.privateKeyPkcs8.fill(0);
      setSigner(nextSigner);
      setCertificate(summary);
      setCertPassword("");
      setStatus({ tone: "success", text: `Certificate for ${summary.commonName || "(no name)"} opened.` });
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof CertificatePasswordError ? error.message : error?.message || "Could not open the certificate.",
      });
    } finally {
      setIsWorking(false);
    }
  };

  const now = new Date();
  const expired = certificate && (now > certificate.notAfter || now < certificate.notBefore);
  const finalReason = reason === "custom" ? customReason.trim() : reason;
  const canSign = Boolean(pdf.bytes && signer && !pdf.signed && !expired);

  const handleSign = async (event) => {
    event.preventDefault();
    if (!canSign) return;
    setIsWorking(true);
    setStatus({ tone: "info", text: "Signing your PDF..." });
    try {
      const spot = POSITIONS[position];
      const signed = await signPdfWithCertificate(pdf.bytes, signer, {
        reason: finalReason,
        location: location.trim(),
        visible: visible ? { pageIndex, x: spot.x, y: spot.y, ...BOX } : null,
      });
      // Check our own output before handing it over.
      const [check] = await verifyPdfSignatures(signed);
      if (!check?.intact || !check.coversWholeFile) {
        throw new Error("The signed file did not pass verification. Nothing was downloaded.");
      }
      const blob = new Blob([signed as BlobPart], { type: "application/pdf" });
      downloadBlob(blob, `${toBaseName(pdf.file.name, "document")}-signed.pdf`);
      setStatus({
        tone: "success",
        text: `Signed and verified (${formatBytes(blob.size)}). Your download has started.`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: `Signing failed: ${error?.message || "Please try again."}` });
    } finally {
      setIsWorking(false);
    }
  };

  const busy = isWorking || pdf.isReading;
  const spot = POSITIONS[position];

  return (
    <PdfToolPage
      title="Digital Signature (Certificate)"
      description="Sign a PDF with your digital certificate (.pfx / .p12). Viewers such as Adobe Reader show who signed it and flag any later change. Your certificate and its private key never leave your browser."
      stats={[
        { value: "PAdES", label: "Standard" },
        { value: certificate ? "Ready" : "-", label: "Certificate" },
      ]}
    >
      <PdfToolColumns
        main={
          <form onSubmit={handleSign}>
            {pdf.file ? (
              <SelectedPdfCard file={pdf.file} pageCount={pdf.pageCount} onRemove={pdf.clear} disabled={busy} />
            ) : (
              <FileDropzone
                accept=".pdf,application/pdf"
                disabled={busy}
                onFiles={pdf.selectFiles}
                title="Drag and drop the PDF to sign"
                hint="or click to browse from your device"
              />
            )}
            {pdf.signed ? (
              <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">
                Adding a second signature to an already-signed PDF is not supported yet.
              </p>
            ) : null}

            <section className={`mt-5 ${cardClass}`}>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">1. Your certificate</h3>
              <input
                ref={certInputRef}
                type="file"
                accept=".pfx,.p12,application/x-pkcs12"
                className="hidden"
                onChange={(event) => {
                  chooseCertificate(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              {certificate ? (
                <div className="mt-3">
                  <SummaryList
                    items={[
                      { label: "Signer", value: certificate.commonName || "(no name)" },
                      { label: "Organisation", value: certificate.organization || "-" },
                      { label: "Issued by", value: certificate.issuerCommonName || certificate.issuerOrganization || "-" },
                      { label: "Valid", value: `${formatDate(certificate.notBefore)} – ${formatDate(certificate.notAfter)}` },
                    ]}
                  />
                  {expired ? (
                    <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">This certificate is not valid today, so it cannot be used to sign.</p>
                  ) : certificate.selfSigned ? (
                    <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                      Self-signed certificate: the signature is valid, but viewers will show the signer as untrusted.
                    </p>
                  ) : null}
                  <button type="button" onClick={forgetCertificate} disabled={busy} className={`mt-3 ${secondaryButtonClass}`}>
                    <i className="fa-solid fa-rotate" />
                    Use a different certificate
                  </button>
                </div>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-end">
                  <button type="button" onClick={() => certInputRef.current?.click()} disabled={busy} className={secondaryButtonClass}>
                    <i className="fa-solid fa-id-card" />
                    {certFile ? certFile.name : "Choose .pfx / .p12"}
                  </button>
                  <PasswordInput
                    id="certificate-password"
                    label="Certificate password"
                    value={certPassword}
                    onChange={setCertPassword}
                    disabled={busy || !certFile}
                    autoComplete="off"
                  />
                  <button type="button" onClick={openCertificate} disabled={busy || !certFile} className={primaryButtonClass}>
                    <i className="fa-solid fa-unlock-keyhole" />
                    Open
                  </button>
                </div>
              )}
            </section>

            <fieldset className={`mt-5 ${cardClass}`} disabled={busy}>
              <legend className="px-1 text-sm font-semibold text-slate-900 dark:text-slate-100">2. Signature details</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={fieldLabelClass}>
                  Reason
                  <select value={reason} onChange={(event) => setReason(event.target.value)} className={`mt-2 ${inputClass}`}>
                    {REASONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                    <option value="custom">Other…</option>
                  </select>
                </label>
                <label className={fieldLabelClass}>
                  Location (optional)
                  <input type="text" value={location} maxLength={80} onChange={(event) => setLocation(event.target.value)} placeholder="City" className={`mt-2 ${inputClass}`} />
                </label>
                {reason === "custom" ? (
                  <label className={`sm:col-span-2 ${fieldLabelClass}`}>
                    Your reason
                    <input type="text" value={customReason} maxLength={120} onChange={(event) => setCustomReason(event.target.value)} className={`mt-2 ${inputClass}`} />
                  </label>
                ) : null}
              </div>

              <label className="mt-4 flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} className="h-4 w-4 accent-[#1F8CFF]" />
                Show a signature box on the page
              </label>
              {visible && pdf.pageCount ? (
                <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className={fieldLabelClass}>
                      Page
                      <select value={pageIndex} onChange={(event) => setPageIndex(Number(event.target.value))} className={`mt-2 ${inputClass}`}>
                        {Array.from({ length: pdf.pageCount }, (_, index) => (
                          <option key={index} value={index}>
                            Page {index + 1}
                            {index === pdf.pageCount - 1 ? " (last)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={fieldLabelClass}>
                      Position
                      <select value={position} onChange={(event) => setPosition(event.target.value)} className={`mt-2 ${inputClass}`}>
                        {Object.entries(POSITIONS).map(([value, option]) => (
                          <option key={value} value={value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {preview ? (
                    <div className="relative mx-auto w-28 shadow-sm" style={{ aspectRatio: `${preview.width} / ${preview.height}` }}>
                      <img src={preview.url} alt={`Page ${pageIndex + 1} preview`} className="absolute inset-0 h-full w-full" />
                      <div
                        className="absolute border-2 border-[#1F8CFF] bg-[#1F8CFF]/15"
                        style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, width: `${BOX.width * 100}%`, height: `${BOX.height * 100}%` }}
                        aria-hidden="true"
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </fieldset>

            <StatusBanner status={status} />

            <div className="mt-5 flex flex-wrap gap-3">
              <button type="submit" disabled={busy || !canSign || (reason === "custom" && !finalReason)} className={primaryButtonClass}>
                <i className={`fa-solid ${isWorking ? "fa-spinner fa-spin" : "fa-file-signature"}`} />
                {isWorking ? "Working..." : "Sign & Download"}
              </button>
              <BackToPdfTools />
            </div>
          </form>
        }
        side={
          <>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">About digital signatures</h2>
            <SideTips
              tips={[
                "This is a cryptographic signature (PAdES), not just an image. Any later change to the file is detected.",
                "Whether viewers show it as trusted depends on who issued your certificate, not on this tool.",
                "Your .pfx file, its password, and its private key stay in this browser tab and are never uploaded.",
                "USB token DSCs (ePass, ProxKey, etc.) need a small local helper; that support is coming.",
                "Check any signed PDF with Verify Signatures.",
              ]}
            />
          </>
        }
      />
    </PdfToolPage>
  );
}
