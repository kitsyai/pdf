// Sign a PDF with a certificate: PAdES baseline (ETSI.CAdES.detached).
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setFontAndSize,
  setLineWidth,
  setStrokingRgbColor,
  showText,
  moveText,
  stroke,
} from "pdf-lib";
import { loadPdf } from "../shared/files";
import { textOrigin, visualSize } from "../shared/pageGeometry";
import { hasDigitalSignatures, signatureFields } from "../shared/signatureFields";
import { placementToVisual } from "../sign/signPdfCore";
import { buildCmsSignature, describeCertificate, sha256, type RawSigner } from "./cms";

const N = (name: string) => PDFName.of(name);
const PLACEHOLDER = 1234567890;
const latin1 = new TextDecoder("latin1");

export type VisibleSignature = {
  pageIndex: number;
  /** Fractions (0-1) of the visible page, from its top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CertificateSignOptions = {
  reason?: string;
  location?: string;
  contactInfo?: string;
  /** Omit for an invisible signature. */
  visible?: VisibleSignature | null;
  signingTime?: Date;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** "2026.11.01 14:05:09 +05'30'" in the signer's local time. */
export function displayDate(date: Date) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ` +
    `${sign}${pad(Math.floor(abs / 60))}'${pad(abs % 60)}'`
  );
}

function uniqueFieldName(doc: PDFDocument) {
  const taken = new Set(doc.getForm().getFields().map((field) => field.getName()));
  signatureFields(doc).forEach((field) => taken.add(field.name));
  let index = 1;
  while (taken.has(`Signature${index}`)) index += 1;
  return `Signature${index}`;
}

/** Text the standard Helvetica font can encode; anything else becomes "?". */
function safeText(font, value: string) {
  return Array.from(value)
    .map((char) => {
      try {
        font.encodeText(char);
        return char;
      } catch {
        return "?";
      }
    })
    .join("");
}

async function appearance(doc: PDFDocument, page, box, lines: string[], angle: number) {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const { width, height } = box;
  const padding = Math.min(6, width * 0.05, height * 0.08);
  const shown = lines.map((line) => safeText(font, line));
  const widest = Math.max(...shown.map((line) => font.widthOfTextAtSize(line, 10)), 1);
  const size = Math.max(4, Math.min(10, (10 * (width - padding * 2)) / widest, (height - padding * 2) / (shown.length * 1.25)));

  const operators = [
    pushGraphicsState(),
    setStrokingRgbColor(0.12, 0.35, 0.75),
    setLineWidth(0.8),
    rectangle(0.4, 0.4, width - 0.8, height - 0.8),
    stroke(),
    setFillingRgbColor(0.06, 0.09, 0.16),
    beginText(),
    setFontAndSize(N("F1"), size),
    moveText(padding, height - padding - size),
  ];
  shown.forEach((line, index) => {
    if (index > 0) operators.push(moveText(0, -size * 1.25));
    operators.push(showText(font.encodeText(line)));
  });
  operators.push(endText(), popGraphicsState());

  const radians = (angle * Math.PI) / 180;
  const cos = Math.round(Math.cos(radians));
  const sin = Math.round(Math.sin(radians));
  const stream = doc.context.formXObject(operators, {
    BBox: [0, 0, width, height],
    // Counter the page's /Rotate so the box reads upright on screen.
    Matrix: [cos, sin, -sin, cos, 0, 0],
    Resources: { Font: { F1: font.ref } },
  });
  return doc.context.register(stream);
}

function findPlaceholders(bytes: Uint8Array, contentsLength: number) {
  const text = latin1.decode(bytes);
  const zeros = "0".repeat(contentsLength);
  const contentsStart = text.lastIndexOf(`<${zeros}>`);
  if (contentsStart < 0) throw new Error("Could not prepare the signature (contents placeholder not found).");
  const contentsEnd = contentsStart + contentsLength + 2;

  const pattern = /\/ByteRange\s*\[\s*0\s+1234567890\s+1234567890\s+1234567890\s*\]/g;
  let match;
  let last = null;
  while ((match = pattern.exec(text))) last = match;
  if (!last) throw new Error("Could not prepare the signature (byte range placeholder not found).");
  const open = last.index + last[0].indexOf("[");
  const close = last.index + last[0].length - 1;
  return { contentsStart, contentsEnd, byteRangeOpen: open, byteRangeClose: close };
}

/**
 * Add a digital signature. Rejects PDFs that are already signed: rewriting
 * the file (as pdf-lib does) would invalidate the existing signature.
 */
export async function signPdfWithCertificate(
  bytes: ArrayBuffer | Uint8Array,
  signer: RawSigner,
  options: CertificateSignOptions = {}
) {
  const doc = await loadPdf(bytes, { updateMetadata: false });
  if (hasDigitalSignatures(doc)) {
    throw new Error(
      "This PDF is already digitally signed. Adding another signature here would invalidate the existing one."
    );
  }

  const certificate = describeCertificate(signer.certificate);
  const signingTime = options.signingTime ?? new Date();
  const certBytes = signer.certificate.length + (signer.chain || []).reduce((sum, der) => sum + der.length, 0);
  // Room for the certificates, signature, attributes, and a future timestamp.
  const reserved = certBytes + 8192;

  const signatureDict = doc.context.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "ETSI.CAdES.detached",
    ByteRange: [0, PLACEHOLDER, PLACEHOLDER, PLACEHOLDER],
    Contents: PDFHexString.of("0".repeat(reserved * 2)),
    M: PDFString.fromDate(signingTime),
  }) as PDFDict;
  if (certificate.commonName) signatureDict.set(N("Name"), PDFHexString.fromText(certificate.commonName));
  if (options.reason) signatureDict.set(N("Reason"), PDFHexString.fromText(options.reason));
  if (options.location) signatureDict.set(N("Location"), PDFHexString.fromText(options.location));
  if (options.contactInfo) signatureDict.set(N("ContactInfo"), PDFHexString.fromText(options.contactInfo));
  const signatureRef = doc.context.register(signatureDict);

  const pages = doc.getPages();
  const pageIndex = options.visible ? options.visible.pageIndex : 0;
  const page = pages[pageIndex];
  if (!page) throw new Error(`Page ${pageIndex + 1} does not exist.`);

  let rect = [0, 0, 0, 0];
  let appearanceRef: PDFRef;
  if (options.visible) {
    const { visualWidth, visualHeight } = visualSize(page);
    const box = placementToVisual(options.visible, visualWidth, visualHeight);
    const a = textOrigin(page, box.vx, box.vy);
    const b = textOrigin(page, box.vx + box.width, box.vy + box.height);
    rect = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
    const lines = [
      `Digitally signed by ${certificate.commonName || "(no name)"}`,
      `Date: ${displayDate(signingTime)}`,
      ...(options.reason ? [`Reason: ${options.reason}`] : []),
      ...(options.location ? [`Location: ${options.location}`] : []),
    ];
    appearanceRef = await appearance(doc, page, box, lines, a.angle);
  } else {
    appearanceRef = doc.context.register(doc.context.formXObject([], { BBox: [0, 0, 0, 0] }));
  }

  const widget = doc.context.obj({
    Type: "Annot",
    Subtype: "Widget",
    FT: "Sig",
    T: PDFHexString.fromText(uniqueFieldName(doc)),
    V: signatureRef,
    F: 132, // Print + Locked
    P: page.ref,
    Rect: rect,
    AP: { N: appearanceRef },
  });
  const widgetRef = doc.context.register(widget);
  page.node.addAnnot(widgetRef);

  let acroForm = doc.catalog.lookup(N("AcroForm"));
  if (!(acroForm instanceof PDFDict)) {
    acroForm = doc.context.obj({ Fields: [] }) as PDFDict;
    doc.catalog.set(N("AcroForm"), doc.context.register(acroForm));
  }
  const form = acroForm as PDFDict;
  let fields = form.lookup(N("Fields"));
  if (!(fields instanceof PDFArray)) {
    fields = doc.context.obj([]);
    form.set(N("Fields"), fields);
  }
  (fields as PDFArray).push(widgetRef);
  form.set(N("SigFlags"), PDFNumber.of(3));

  // No object streams: the signature dictionary must stay plain text so its
  // placeholders can be found and filled in place.
  const prepared = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  const { contentsStart, contentsEnd, byteRangeOpen, byteRangeClose } = findPlaceholders(prepared, reserved * 2);

  const byteRange = [0, contentsStart, contentsEnd, prepared.length - contentsEnd];
  const byteRangeText = ` ${byteRange.join(" ")}`.padEnd(byteRangeClose - byteRangeOpen - 1, " ");
  const output = new Uint8Array(prepared);
  output.set(new TextEncoder().encode(byteRangeText), byteRangeOpen + 1);

  const signed = new Uint8Array(contentsStart + (output.length - contentsEnd));
  signed.set(output.subarray(0, contentsStart), 0);
  signed.set(output.subarray(contentsEnd), contentsStart);
  const cms = await buildCmsSignature(await sha256(signed), signer);
  if (cms.length > reserved) {
    throw new Error("The signature is larger than the space reserved for it.");
  }
  const hex = Array.from(cms, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  output.set(new TextEncoder().encode(hex), contentsStart + 1);

  return output;
}
