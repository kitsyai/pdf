// The Emscripten factory, pointed at the .wasm URL the host app configured.
// Fetched only when Protect / Unlock runs.
import createModule from "@neslinesli93/qpdf-wasm";
import { requireAsset } from "../config";
import type { QpdfFactory } from "./protectPdfCore";

export const browserQpdf: QpdfFactory = (options) => {
  const wasmUrl = requireAsset("qpdfWasmUrl", "Protect / Unlock PDF");
  return (createModule as unknown as QpdfFactory)({ ...options, locateFile: () => wasmUrl });
};
