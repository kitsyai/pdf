import { useCallback, useRef, useState } from "react";
import { isPdfFile, loadPdf } from "./files";
import { hasDigitalSignatures } from "./signatureFields";

export const MAX_SINGLE_PDF_BYTES = 200 * 1024 * 1024;

/**
 * Holds one selected PDF: the File, its bytes and page count once read, or a
 * read error. A newer selection always wins over a slower earlier read.
 */
type SinglePdfOptions = {
  onError?: (message: string) => void;
  onLoaded?: (loaded: { file: File; bytes: ArrayBuffer; pageCount: number }) => void;
};

export function useSinglePdf({ onError, onLoaded }: SinglePdfOptions = {}) {
  const [file, setFile] = useState(null);
  const [bytes, setBytes] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [isReading, setIsReading] = useState(false);
  const [signed, setSigned] = useState(false);
  const requestRef = useRef(0);

  const clear = useCallback(() => {
    requestRef.current += 1;
    setFile(null);
    setBytes(null);
    setPageCount(0);
    setSigned(false);
    setIsReading(false);
  }, []);

  const selectFiles = useCallback(
    async (files) => {
      const next = (files || []).find(isPdfFile);
      if (!next) {
        if (files?.length) onError?.("Only PDF files are supported.");
        return;
      }
      if (next.size > MAX_SINGLE_PDF_BYTES) {
        onError?.("This PDF is larger than 200 MB.");
        return;
      }

      const request = ++requestRef.current;
      setFile(next);
      setBytes(null);
      setPageCount(0);
      setSigned(false);
      setIsReading(true);

      try {
        const data = await next.arrayBuffer();
        const doc = await loadPdf(data);
        if (request !== requestRef.current) return;
        setBytes(data);
        setPageCount(doc.getPageCount());
        setSigned(hasDigitalSignatures(doc));
        onLoaded?.({ file: next, bytes: data, pageCount: doc.getPageCount() });
      } catch (error) {
        if (request !== requestRef.current) return;
        setFile(null);
        onError?.(error?.message || "Could not read this PDF.");
      } finally {
        if (request === requestRef.current) setIsReading(false);
      }
    },
    [onError, onLoaded]
  );

  return { file, bytes, pageCount, signed, isReading, selectFiles, clear };
}
