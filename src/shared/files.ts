import { PDFDocument } from "pdf-lib";

export function isPdfFile(file: { name?: string; type?: string }) {
  return (
    file?.type === "application/pdf" ||
    (file?.name || "").toLowerCase().endsWith(".pdf")
  );
}

export function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const value = Math.floor(Math.log(bytes) / Math.log(1024));
  const normalized = bytes / 1024 ** value;
  return `${normalized.toFixed(normalized >= 10 ? 0 : 1)} ${units[value]}`;
}

/** Strip a known extension and characters that are invalid in file names. */
export function toBaseName(value: string, fallback: string) {
  const base = (value || "")
    .trim()
    .replace(/\.(pdf|zip)$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-");
  return base || fallback;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function loadPdf(
  bytes: ArrayBuffer | Uint8Array,
  options: { updateMetadata?: boolean } = {}
) {
  try {
    return await PDFDocument.load(bytes, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/encrypt/i.test(message)) {
      throw new Error("This PDF is password protected. Remove the password with Protect / Unlock PDF first.");
    }
    throw new Error("This file is not a readable PDF.");
  }
}

export async function getPdfPageCount(bytes: ArrayBuffer | Uint8Array) {
  const doc = await loadPdf(bytes);
  return doc.getPageCount();
}
