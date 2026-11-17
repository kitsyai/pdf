// PAdES long-term validation (LTV): append a Document Security Store (DSS)
// with certificates, OCSP responses and CRLs as an incremental update, so
// validators such as Adobe Reader can check revocation offline, years
// later. The signed bytes are never touched: new objects, a new catalog
// revision, a cross-reference section and a trailer are appended.
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from "pdf-lib";

export type ValidationData = {
  /** Issuing certificates (DER), leaf's issuer first. */
  chain: Uint8Array[];
  /** OCSP responses (DER) for the signing certificate and intermediates. */
  ocsps: Uint8Array[];
  /** CRLs (DER), where OCSP wasn't available. */
  crls: Uint8Array[];
};

const latin1 = new TextDecoder("latin1");
const encoder = new TextEncoder();
const N = (name: string) => PDFName.of(name);

function lastStartxref(pdf: Uint8Array) {
  const tail = latin1.decode(pdf.subarray(Math.max(0, pdf.length - 2048)));
  const match = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!match) throw new Error("Could not find the PDF's cross-reference table.");
  return Number(match[1]);
}

/**
 * Append a DSS holding `certs`, `ocsps` and `crls` to a signed PDF. The
 * catalog gets /DSS and the ESIC extension (PAdES) in a new revision.
 */
export async function appendDss(pdf: Uint8Array, data: { certs: Uint8Array[]; ocsps: Uint8Array[]; crls: Uint8Array[] }) {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false, ignoreEncryption: true });
  const trailer = doc.context.trailerInfo;
  if (trailer.Encrypt) throw new Error("Can't add validation data to an encrypted PDF.");
  const rootRef = trailer.Root as PDFRef;
  const prev = lastStartxref(pdf);

  const chunks: Uint8Array[] = [];
  const offsets = new Map<number, { offset: number; generation: number }>();
  let position = pdf.length;
  const write = (part: Uint8Array | string) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    position += bytes.length;
  };
  if (pdf[pdf.length - 1] !== 0x0a) write("\n");

  let next = doc.context.largestObjectNumber + 1;
  const stream = (bytes: Uint8Array) => {
    const number = next++;
    offsets.set(number, { offset: position, generation: 0 });
    write(`${number} 0 obj\n<< /Length ${bytes.length} >>\nstream\n`);
    write(bytes);
    write("\nendstream\nendobj\n");
    return `${number} 0 R`;
  };
  const unique = (list: Uint8Array[]) => {
    const seen = new Set<string>();
    return list.filter((bytes) => {
      const key = Array.from(bytes.subarray(0, 64)).join(",") + ":" + bytes.length;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const certRefs = unique(data.certs).map(stream);
  const ocspRefs = unique(data.ocsps).map(stream);
  const crlRefs = unique(data.crls).map(stream);

  const dssNumber = next++;
  const entries = [
    "/Type /DSS",
    certRefs.length ? `/Certs [${certRefs.join(" ")}]` : "",
    ocspRefs.length ? `/OCSPs [${ocspRefs.join(" ")}]` : "",
    crlRefs.length ? `/CRLs [${crlRefs.join(" ")}]` : "",
  ].filter(Boolean);
  offsets.set(dssNumber, { offset: position, generation: 0 });
  write(`${dssNumber} 0 obj\n<< ${entries.join(" ")} >>\nendobj\n`);

  // New catalog revision: same entries plus /DSS and the PAdES extension.
  const catalog = doc.context.obj({}) as PDFDict;
  for (const [key, value] of doc.catalog.entries()) catalog.set(key, value);
  catalog.set(N("DSS"), PDFRef.of(dssNumber));
  const existing = doc.catalog.lookup(N("Extensions"));
  const extensions = doc.context.obj({}) as PDFDict;
  if (existing instanceof PDFDict) for (const [key, value] of existing.entries()) extensions.set(key, value);
  extensions.set(N("ESIC"), doc.context.obj({ BaseVersion: N("1.7"), ExtensionLevel: PDFNumber.of(5) }));
  catalog.set(N("Extensions"), extensions);
  offsets.set(rootRef.objectNumber, { offset: position, generation: rootRef.generationNumber });
  write(`${rootRef.objectNumber} ${rootRef.generationNumber} obj\n${catalog.toString()}\nendobj\n`);

  // Cross-reference section: one subsection per run of consecutive numbers.
  const xrefOffset = position;
  const numbers = [...offsets.keys()].sort((a, b) => a - b);
  // Object 0 heads the free list; listing it keeps strict readers happy.
  let xref = "xref\n0 1\n0000000000 65535 f \n";
  for (let i = 0; i < numbers.length; ) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j += 1;
    xref += `${numbers[i]} ${j - i + 1}\n`;
    for (let k = i; k <= j; k += 1) {
      const { offset, generation } = offsets.get(numbers[k])!;
      xref += `${String(offset).padStart(10, "0")} ${String(generation).padStart(5, "0")} n \n`;
    }
    i = j + 1;
  }
  const trailerEntries = [`/Size ${next}`, `/Root ${rootRef.objectNumber} ${rootRef.generationNumber} R`];
  if (trailer.Info) trailerEntries.push(`/Info ${trailer.Info.toString()}`);
  if (trailer.ID) trailerEntries.push(`/ID ${trailer.ID.toString()}`);
  trailerEntries.push(`/Prev ${prev}`);
  write(`${xref}trailer\n<< ${trailerEntries.join(" ")} >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(position);
  out.set(pdf, 0);
  let at = pdf.length;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
