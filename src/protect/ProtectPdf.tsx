import React, { useEffect, useRef, useState } from "react";
import { downloadBlob, formatBytes, isPdfFile, toBaseName } from "../shared/files";
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
  secondaryButtonClass,
} from "../shared/ToolLayout";
import { PasswordInput } from "../shared/PasswordInput";
import { browserQpdf } from "./browserQpdf";
import { PasswordError, isEncrypted, protectPdf, unlockPdf, type PrintPermission } from "./protectPdfCore";

const MAX_BYTES = 200 * 1024 * 1024;

export default function ProtectPdf() {
  const [file, setFile] = useState(null);
  const [bytes, setBytes] = useState(null);
  const [encrypted, setEncrypted] = useState(false);
  const [mode, setMode] = useState("protect");
  const [userPassword, setUserPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [print, setPrint] = useState<PrintPermission>("full");
  const [extract, setExtract] = useState(true);
  const [modify, setModify] = useState(true);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [generatedOwner, setGeneratedOwner] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [status, setStatus] = useState({
    tone: "info",
    text: "Add a PDF to protect it with a password, or to remove a password you know.",
  });
  const unlockInputRef = useRef(null);
  const requestRef = useRef(0);

  useEffect(() => {
    document.title = "Protect / Unlock PDF | Apps";
  }, []);

  // After a password error, put the cursor in the password box once the form
  // is enabled again (a disabled input can't take focus).
  useEffect(() => {
    if (needsPassword && !isWorking) unlockInputRef.current?.focus();
  }, [needsPassword, isWorking, status]);

  const resetSecrets = () => {
    setUserPassword("");
    setConfirmPassword("");
    setOwnerPassword("");
    setUnlockPassword("");
    setGeneratedOwner("");
    setNeedsPassword(false);
  };

  const selectFiles = async (files) => {
    const next = files.find(isPdfFile);
    if (!next) {
      if (files.length) setStatus({ tone: "error", text: "Only PDF files are supported." });
      return;
    }
    if (next.size > MAX_BYTES) {
      setStatus({ tone: "error", text: "This PDF is larger than 200 MB." });
      return;
    }
    const request = ++requestRef.current;
    resetSecrets();
    setFile(next);
    setBytes(null);
    try {
      const data = new Uint8Array(await next.arrayBuffer());
      const locked = await isEncrypted(data);
      if (request !== requestRef.current) return;
      setBytes(data);
      setEncrypted(locked);
      setMode(locked ? "unlock" : "protect");
      setStatus(
        locked
          ? { tone: "info", text: `${next.name} is protected. Enter its password if it has one, then unlock.` }
          : { tone: "success", text: `${next.name} loaded. Choose a password and permissions.` }
      );
    } catch (error) {
      if (request !== requestRef.current) return;
      setFile(null);
      setStatus({ tone: "error", text: error?.message || "Could not read this PDF." });
    }
  };

  const clearFile = () => {
    requestRef.current += 1;
    setFile(null);
    setBytes(null);
    setEncrypted(false);
    resetSecrets();
  };

  const mismatch = Boolean(confirmPassword) && userPassword !== confirmPassword;
  const restricted = print !== "full" || !extract || !modify;
  const canProtect = Boolean(bytes) && !encrypted && !mismatch && (userPassword ? userPassword === confirmPassword : restricted);

  const handleProtect = async (event) => {
    event.preventDefault();
    if (!canProtect) return;
    setIsWorking(true);
    setGeneratedOwner("");
    setStatus({ tone: "info", text: "Encrypting your PDF..." });
    try {
      const result = await protectPdf(bytes, { userPassword, ownerPassword, print, extract, modify }, browserQpdf);
      const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
      downloadBlob(blob, `${toBaseName(file.name, "document")}-protected.pdf`);
      if (!ownerPassword) setGeneratedOwner(result.ownerPassword);
      setStatus({
        tone: "success",
        text: `Protected with AES-256 (${formatBytes(blob.size)}). Your download has started.`,
      });
    } catch (error) {
      setStatus({ tone: "error", text: error?.message || "Could not protect this PDF." });
    } finally {
      setIsWorking(false);
    }
  };

  const handleUnlock = async (event) => {
    event.preventDefault();
    if (!bytes || !encrypted) return;
    setIsWorking(true);
    setStatus({ tone: "info", text: "Unlocking your PDF..." });
    try {
      const unlocked = await unlockPdf(bytes, unlockPassword, browserQpdf);
      const blob = new Blob([unlocked as BlobPart], { type: "application/pdf" });
      downloadBlob(blob, `${toBaseName(file.name, "document")}-unlocked.pdf`);
      setNeedsPassword(false);
      setStatus({
        tone: "success",
        text: `Unlocked (${formatBytes(blob.size)}). The password and restrictions are removed. Your download has started.`,
      });
    } catch (error) {
      if (error instanceof PasswordError) {
        setNeedsPassword(true);
        setStatus({ tone: "error", text: error.message });
      } else {
        setStatus({ tone: "error", text: error?.message || "Could not unlock this PDF." });
      }
    } finally {
      setIsWorking(false);
    }
  };

  const busy = isWorking;

  return (
    <PdfToolPage
      title="Protect / Unlock PDF"
      description="Add a password and permissions to a PDF with AES-256 encryption, or remove a password you know. Runs in your browser with qpdf; files and passwords never leave your device."
      stats={[
        { value: "AES", label: "256-bit" },
        { value: file ? (encrypted ? "Locked" : "Open") : "-", label: "File" },
      ]}
    >
      <PdfToolColumns
        main={
          <>
            {file ? (
              <SelectedPdfCard
                file={file}
                pageCount={0}
                detail={bytes ? (encrypted ? "Password protected" : "Not protected") : "reading..."}
                onRemove={clearFile}
                disabled={busy}
              />
            ) : (
              <FileDropzone
                accept=".pdf,application/pdf"
                disabled={busy}
                onFiles={selectFiles}
                icon="fa-solid fa-lock"
                title="Drag and drop a PDF here"
                hint="Protected PDFs open in Unlock mode automatically."
              />
            )}

            {bytes && !encrypted ? (
              <form onSubmit={handleProtect} className={`mt-5 ${cardClass}`}>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Protect</h3>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <PasswordInput
                    id="user-password"
                    label="Password to open"
                    value={userPassword}
                    onChange={setUserPassword}
                    disabled={busy}
                    hint={userPassword && userPassword.length < 8 ? "Short passwords are easy to guess. Use 8+ characters." : "Leave empty to only restrict printing, copying, or editing."}
                  />
                  <PasswordInput
                    id="confirm-password"
                    label="Confirm password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    disabled={busy || !userPassword}
                    hint={mismatch ? "Passwords don't match." : ""}
                  />
                </div>

                <fieldset className="mt-5 grid gap-3 sm:grid-cols-3" disabled={busy}>
                  <legend className={`${fieldLabelClass} mb-2`}>Permissions</legend>
                  <label className={fieldLabelClass}>
                    Printing
                    <select value={print} onChange={(event) => setPrint(event.target.value as PrintPermission)} className={`mt-2 ${inputClass}`}>
                      <option value="full">Allowed</option>
                      <option value="low">Low quality only</option>
                      <option value="none">Not allowed</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 self-end text-sm text-slate-700 dark:text-slate-300">
                    <input type="checkbox" checked={extract} onChange={(event) => setExtract(event.target.checked)} className="h-4 w-4 accent-[#1F8CFF]" />
                    Allow copying text
                  </label>
                  <label className="flex items-center gap-2 self-end text-sm text-slate-700 dark:text-slate-300">
                    <input type="checkbox" checked={modify} onChange={(event) => setModify(event.target.checked)} className="h-4 w-4 accent-[#1F8CFF]" />
                    Allow editing
                  </label>
                </fieldset>

                {restricted ? (
                  <div className="mt-5">
                    <PasswordInput
                      id="owner-password"
                      label="Owner password (to change permissions later)"
                      value={ownerPassword}
                      onChange={setOwnerPassword}
                      disabled={busy}
                      hint="Optional. If empty, a strong random one is generated and shown after saving."
                    />
                  </div>
                ) : null}

                <StatusBanner status={status} />

                {generatedOwner ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                    <p className="font-semibold">Generated owner password, save it if you may want to change permissions:</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <code className="select-all break-all rounded bg-white/80 px-2 py-1 text-sm text-slate-900 dark:bg-slate-900 dark:text-slate-100">
                        {generatedOwner}
                      </code>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(generatedOwner)}
                        className={secondaryButtonClass}
                      >
                        <i className="fa-solid fa-copy" />
                        Copy
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="submit" disabled={busy || !canProtect} className={primaryButtonClass}>
                    <i className={`fa-solid ${isWorking ? "fa-spinner fa-spin" : "fa-lock"}`} />
                    {isWorking ? "Protecting..." : "Protect & Download"}
                  </button>
                  <BackToPdfTools />
                </div>
              </form>
            ) : null}

            {bytes && encrypted ? (
              <form onSubmit={handleUnlock} className={`mt-5 ${cardClass}`}>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Unlock</h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  {needsPassword
                    ? "This PDF needs its password to open. Enter it to remove the protection."
                    : "Files that only restrict printing or copying unlock without a password. Otherwise, enter the password."}
                </p>
                <div className="mt-4 max-w-md">
                  <PasswordInput
                    id="unlock-password"
                    label="Password"
                    value={unlockPassword}
                    onChange={setUnlockPassword}
                    disabled={busy}
                    autoComplete="off"
                    inputRef={unlockInputRef}
                  />
                </div>

                <StatusBanner status={status} />

                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="submit" disabled={busy} className={primaryButtonClass}>
                    <i className={`fa-solid ${isWorking ? "fa-spinner fa-spin" : "fa-lock-open"}`} />
                    {isWorking ? "Unlocking..." : "Unlock & Download"}
                  </button>
                  <BackToPdfTools />
                </div>
              </form>
            ) : null}

            {!bytes ? (
              <>
                <StatusBanner status={status} />
                <div className="mt-5 flex flex-wrap gap-3">
                  <BackToPdfTools />
                </div>
              </>
            ) : null}
          </>
        }
        side={
          <>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">How it works</h2>
            <SideTips
              tips={[
                "Encryption uses AES-256 (PDF 2.0 standard), supported by all modern viewers.",
                "The open password can't be recovered if you forget it. Keep a copy somewhere safe.",
                "Permissions are honoured by viewers but are not a hard lock: anyone who can open the file could remove them.",
                "Unlock only works with a password you know; it doesn't crack passwords.",
              ]}
            />
            <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
              Powered by qpdf (Apache-2.0) compiled to WebAssembly. The engine (~1.3 MB) loads the first time you use this tool.
            </p>
          </>
        }
      />
    </PdfToolPage>
  );
}
