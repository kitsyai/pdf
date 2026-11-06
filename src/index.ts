// @kitsy/pdf core: framework-free PDF operations. Everything here takes and
// returns bytes (ArrayBuffer / Uint8Array) and runs in the browser; most of it
// also runs in Node. React UIs live under "@kitsy/pdf/react".

export { configurePdf, getPdfConfig, type PdfConfig } from "./config";

// Shared helpers
export { downloadBlob, formatBytes, getPdfPageCount, isPdfFile, loadPdf, toBaseName } from "./shared/files";
export { parsePageGroups, parsePageSelection } from "./shared/pageRanges";
export { hasDigitalSignatures, signatureFields, type SignatureField } from "./shared/signatureFields";
export { createZip, crc32, type ZipEntry } from "./shared/zip";
export { canvasToBlob, loadPdfJs, openRenderDocument, renderPageToCanvas, renderThumbnail } from "./shared/pdfRender";

// Tools
export { mergePdfs, type MergePdfOptions, type MergePdfSource } from "./merge/mergePdfCore";
export { planSplit, splitPdf, type SplitMode, type SplitPdfOptions, type SplitPdfOutput } from "./split/splitPdfCore";
export {
  detectImageKind,
  getJpegOrientation,
  imagesToPdf,
  layoutImage,
  type ImageKind,
  type ImageSource,
  type ImagesToPdfOptions,
  type OrientationOption,
  type PageSizeOption,
} from "./images/imagesToPdfCore";
export {
  formatPageNumber,
  planStampedPages,
  stampPdf,
  textOrigin,
  visualToUser,
  type NumberPosition,
  type PageNumberOptions,
  type StampPdfOptions,
  type WatermarkOptions,
} from "./stamp/stampPdfCore";
export {
  readPdfMetadata,
  splitKeywords,
  writePdfMetadata,
  type PdfMetadata,
  type PdfMetadataFields,
} from "./metadata/pdfMetadataCore";
export { organizePdf, type PageEdit } from "./organize/organizePdfCore";
export { applySignatures, placementToVisual, type SignaturePlacement } from "./sign/signPdfCore";
export { opaqueBounds, whiteToTransparent } from "./sign/signatureImage";
export { dpiToScale, imageFileName, renderedSize, type ImageFormat } from "./toimages/pdfToImagesCore";
export {
  COMPRESSION_LEVELS,
  colorComponents,
  compressPdf,
  unpredictPng,
  type CompressStats,
  type CompressTarget,
  type ImageCodec,
} from "./compress/compressPdfCore";
export { browserCodec } from "./compress/browserCodec";
export { fillForm, readFormFields, type FieldKind, type FormFieldInfo, type FormValues } from "./forms/fillFormCore";
export {
  PasswordError,
  isEncrypted,
  protectPdf,
  randomPassword,
  unlockPdf,
  type PrintPermission,
  type ProtectOptions,
  type QpdfFactory,
} from "./protect/protectPdfCore";
export { browserQpdf } from "./protect/browserQpdf";

// Digital (certificate) signatures
export { CertificatePasswordError, readPkcs12 } from "./certsign/pkcs12";
export {
  buildCmsSignature,
  describeCertificate,
  webCryptoSigner,
  type CertificateSummary,
  type RawSigner,
} from "./certsign/cms";
export {
  displayDate,
  signPdfWithCertificate,
  type CertificateSignOptions,
  type VisibleSignature,
} from "./certsign/padesCore";
export { parsePdfDate, verifyPdfSignatures, type SignatureCheck } from "./certsign/verifyCore";
export {
  HEY_HUB_URL,
  HeyDscError,
  findTokenCertificates,
  heyTokenSigner,
  type HeyDscErrorCode,
  type TokenCertificate,
} from "./certsign/heySigner";
