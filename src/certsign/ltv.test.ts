import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { testIdentity } from "../test-utils/certificates";
import { webCryptoSigner } from "./cms";
import { signPdfWithCertificate } from "./padesCore";
import { readPkcs12 } from "./pkcs12";
import { verifyPdfSignatures } from "./verifyCore";

async function samplePdf() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.setTitle("Agreement");
  return doc.save();
}

async function signer() {
  return webCryptoSigner(readPkcs12(testIdentity().pfxAes, "pass-aes"));
}

const fakeOcsp = new Uint8Array([0x30, 0x03, 0x0a, 0x01, 0x00]);

/** Append an incremental update that replaces object `number` with `body`. */
function appendRevision(pdf: Uint8Array, number: number, body: string) {
  const text = new TextDecoder("latin1").decode(pdf);
  const prev = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)![1];
  const root = /\/Root (\d+ \d+ R)/g;
  let rootRef = "";
  for (let m; (m = root.exec(text)); ) rootRef = m[1];
  const sizeMatch = [...text.matchAll(/\/Size (\d+)/g)].pop()!;
  const objOffset = pdf.length;
  const obj = `${number} 0 obj\n${body}\nendobj\n`;
  const xrefOffset = objOffset + obj.length;
  const tail = `${obj}xref\n${number} 1\n${String(objOffset).padStart(10, "0")} 00000 n \ntrailer\n<< /Size ${sizeMatch[1]} /Root ${rootRef} /Prev ${prev} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const out = new Uint8Array(pdf.length + tail.length);
  out.set(pdf);
  out.set(new TextEncoder().encode(tail), pdf.length);
  return out;
}

describe("long-term validation (DSS)", () => {
  it("embeds the chain and revocation data without touching the signed bytes", async () => {
    const { caDer } = testIdentity();
    const signed = await signPdfWithCertificate(await samplePdf(), await signer(), {
      reason: "LTV test",
      ltv: { chain: [caDer], ocsps: [fakeOcsp], crls: [] },
    });

    const [check] = await verifyPdfSignatures(signed);
    expect(check).toMatchObject({
      intact: true,
      coversWholeFile: false,
      laterChangesAreValidationData: true,
      hasValidationData: true,
    });

    const doc = await PDFDocument.load(signed);
    const dss = doc.catalog.lookup(PDFName.of("DSS"), PDFDict);
    const certs = dss.lookup(PDFName.of("Certs"), PDFArray);
    const ocsps = dss.lookup(PDFName.of("OCSPs"), PDFArray);
    expect(certs.size()).toBe(2); // signing certificate + CA
    expect(Array.from((ocsps.lookup(0) as PDFRawStream).getContents())).toEqual(Array.from(fakeOcsp));
    const esic = doc.catalog.lookup(PDFName.of("Extensions"), PDFDict).lookup(PDFName.of("ESIC"), PDFDict);
    expect(esic.get(PDFName.of("ExtensionLevel"))?.toString()).toBe("5");
    // The document itself is unchanged.
    expect(doc.getTitle()).toBe("Agreement");
    expect(doc.getPageCount()).toBe(1);
  });

  it("still flags real changes made after signing, even with a DSS", async () => {
    const { caDer } = testIdentity();
    const signed = await signPdfWithCertificate(await samplePdf(), await signer(), {
      ltv: { chain: [caDer], ocsps: [fakeOcsp], crls: [] },
    });
    const doc = await PDFDocument.load(signed);
    const pageRef = doc.getPage(0).ref;
    const changed = appendRevision(signed, pageRef.objectNumber, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>");
    const [check] = await verifyPdfSignatures(changed);
    expect(check.intact).toBe(true);
    expect(check.laterChangesAreValidationData).toBe(false);
  });

  it("skips the DSS when there is no revocation data", async () => {
    const signed = await signPdfWithCertificate(await samplePdf(), await signer(), { ltv: { chain: [], ocsps: [], crls: [] } });
    const [check] = await verifyPdfSignatures(signed);
    expect(check).toMatchObject({ intact: true, coversWholeFile: true, hasValidationData: false });
  });
});
