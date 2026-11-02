import { useEffect, useState } from "react";
import { openRenderDocument, renderThumbnail } from "./pdfRender";

/** Open bytes in pdf.js; destroys the previous document when bytes change. */
export function useRenderDocument(bytes) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!bytes) {
      setDoc(null);
      setError("");
      return undefined;
    }

    let cancelled = false;
    let opened = null;
    setDoc(null);
    setError("");
    openRenderDocument(bytes)
      .then((result) => {
        opened = result;
        if (cancelled) {
          result.destroy();
        } else {
          setDoc(result);
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(reason?.message || "Could not render this PDF.");
      });

    return () => {
      cancelled = true;
      opened?.destroy();
    };
  }, [bytes]);

  return { doc, error };
}

/**
 * Render page thumbnails one after another (to keep memory and the worker
 * calm), exposing each as soon as it is ready. Index i is page i + 1.
 */
export function useThumbnails(doc, width = 160) {
  const [thumbnails, setThumbnails] = useState([]);

  useEffect(() => {
    if (!doc) {
      setThumbnails([]);
      return undefined;
    }

    let cancelled = false;
    const urls = [];
    setThumbnails(Array.from({ length: doc.numPages }, () => null));

    (async () => {
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        if (cancelled) return;
        try {
          const thumb = await renderThumbnail(doc, pageNumber, width);
          if (cancelled) {
            URL.revokeObjectURL(thumb.url);
            return;
          }
          urls.push(thumb.url);
          setThumbnails((current) => {
            const next = [...current];
            next[pageNumber - 1] = thumb;
            return next;
          });
        } catch {
          if (cancelled) return;
        }
      }
    })();

    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [doc, width]);

  return thumbnails;
}
