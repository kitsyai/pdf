import React, { useCallback, useEffect, useRef, useState } from "react";
import { isPdfFile } from "../shared/files";
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
} from "../shared/ToolLayout";
import { MAX_SINGLE_PDF_BYTES } from "../shared/useSinglePdf";
import { verifyPdfSignatures, type SignatureCheck } from "./verifyCore";

const formatDay = (date: Date) =>
  date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function verdict(check: SignatureCheck) {
  if (check.intact && check.coversWholeFile) {
    return { tone: "good", icon: "fa-circle-check", title: "Signature is valid", detail: "The document has not changed since it was signed." };
  }
  if (check.intact) {
    return {
      tone: "warn",
      icon: "fa-triangle-exclamation",
      title: "Valid, but the file was changed later",
      detail: "The signed version is intact, but content was added after signing (for example a later signature, comments, or edits).",
    };
  }
  if (check.intact === false) {
    return { tone: "bad", icon: "fa-circle-xmark", title: "Signature is invalid", detail: check.problem || "The document was changed after it was signed." };
  }
  return { tone: "warn", icon: "fa-circle-question", title: "Could not be checked", detail: check.problem || "This signature could not be verified." };
}

const TONES = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100",
  warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100",
  bad: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100",
};

function SignatureCard({ check, index }: { check: SignatureCheck; index: number }) {
  const result = verdict(check);
  const signer = check.signer;
  return (
    <section className={`mt-5 ${cardClass}`} data-testid="signature-result">
      <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${TONES[result.tone]}`}>
        <i className={`fa-solid ${result.icon} mt-0.5`} />
        <div>
          <p className="text-sm font-semibold">{result.title}</p>
          <p className="mt-0.5 text-xs">{result.detail}</p>
        </div>
      </div>
      <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-100">
        Signature {index + 1}
        <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">({check.fieldName})</span>
      </h3>
      <SummaryList
        items={[
          { label: "Signed by", value: signer?.commonName || "-" },
          { label: "Organisation", value: signer?.organization || "-" },
          { label: "Email", value: signer?.email || "-" },
          { label: "Certificate issued by", value: signer ? signer.issuerCommonName || signer.issuerOrganization || "-" : "-" },
          { label: "Certificate valid", value: signer ? `${formatDay(signer.notBefore)} – ${formatDay(signer.notAfter)}` : "-" },
          { label: "Signed on", value: check.signingTime ? check.signingTime.toLocaleString() : "-" },
          { label: "Reason", value: check.reason || "-" },
          { label: "Location", value: check.location || "-" },
          { label: "Format", value: check.subFilter || "-" },
        ]}
      />
      {!check.coversWholeFile ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Signed on, reason, and location are read from the file's latest version, which was changed after signing, so
          they may not be what the signer wrote.
        </p>
      ) : null}
      {signer?.selfSigned ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">The certificate is self-signed, so anyone could have made it.</p>
      ) : null}
      {check.certificateValidAtSigning === false ? (
        <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">The certificate was not valid at the claimed signing time.</p>
      ) : null}
    </section>
  );
}

export default function VerifyPdfSignatures() {
  const requestRef = useRef(0);
  const [file, setFile] = useState(null);
  const [checks, setChecks] = useState<SignatureCheck[] | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [status, setStatus] = useState({ tone: "info", text: "Add a signed PDF to check its digital signatures." });

  useEffect(() => {
    document.title = "Verify PDF Signatures | Apps";
  }, []);

  const clear = () => {
    requestRef.current += 1;
    setFile(null);
    setChecks(null);
    setIsReading(false);
    setStatus({ tone: "info", text: "Add a signed PDF to check its digital signatures." });
  };

  // Own loader: encrypted PDFs can still be verified, so this skips useSinglePdf.
  const selectFiles = useCallback(async (files) => {
    const next = (files || []).find(isPdfFile);
    if (!next) {
      if (files?.length) setStatus({ tone: "error", text: "Only PDF files are supported." });
      return;
    }
    if (next.size > MAX_SINGLE_PDF_BYTES) {
      setStatus({ tone: "error", text: "This PDF is larger than 200 MB." });
      return;
    }
    const request = ++requestRef.current;
    setFile(next);
    setChecks(null);
    setIsReading(true);
    setStatus({ tone: "info", text: "Checking signatures..." });
    try {
      const result = await verifyPdfSignatures(await next.arrayBuffer());
      if (request !== requestRef.current) return;
      setChecks(result);
      const valid = result.filter((check) => check.intact && check.coversWholeFile).length;
      setStatus(
        result.length
          ? {
              tone: valid === result.length ? "success" : "error",
              text: `${result.length} signature${result.length === 1 ? "" : "s"} found, ${valid} fully valid.`,
            }
          : { tone: "info", text: `${next.name} has no digital signatures.` }
      );
    } catch (error) {
      if (request !== requestRef.current) return;
      setFile(null);
      setStatus({ tone: "error", text: error?.message || "Could not read this PDF." });
    } finally {
      if (request === requestRef.current) setIsReading(false);
    }
  }, []);

  return (
    <PdfToolPage
      title="Verify PDF Signatures"
      description="Check the digital signatures in a PDF: who signed it, when, and whether it has changed since. Runs in your browser; files never leave your device."
      stats={[
        { value: checks ? checks.length : "-", label: "Signatures" },
        { value: checks ? checks.filter((check) => check.intact && check.coversWholeFile).length : "-", label: "Valid" },
      ]}
    >
      <PdfToolColumns
        main={
          <div>
            {file ? (
              <SelectedPdfCard
                file={file}
                pageCount={0}
                detail={isReading ? "checking..." : `${checks?.length ?? 0} signature${checks?.length === 1 ? "" : "s"}`}
                onRemove={clear}
                disabled={isReading}
              />
            ) : (
              <FileDropzone
                accept=".pdf,application/pdf"
                disabled={isReading}
                onFiles={selectFiles}
                title="Drag and drop a signed PDF here"
                hint="or click to browse from your device"
              />
            )}
            <StatusBanner status={status} />
            {(checks || []).map((check, index) => (
              <SignatureCard key={`${check.fieldName}-${index}`} check={check} index={index} />
            ))}
            <div className="mt-5 flex flex-wrap gap-3">
              <BackToPdfTools />
            </div>
          </div>
        }
        side={
          <>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">What is checked</h2>
            <SideTips
              tips={[
                "Integrity: the signed bytes still match the signature.",
                "Coverage: whether anything was added to the file after signing.",
                "Signer details come from the certificate inside the signature.",
                "Not checked: whether the certificate is trusted, revoked, or issued by a licensed authority. Use Adobe Reader for a trust check.",
              ]}
            />
          </>
        }
      />
    </PdfToolPage>
  );
}
