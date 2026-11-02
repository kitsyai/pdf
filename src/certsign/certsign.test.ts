import * as asn1js from "asn1js";
import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, degrees } from "pdf-lib";
import { testIdentity } from "../test-utils/certificates";
import { buildCmsSignature, describeCertificate, webCryptoSigner } from "./cms";
import { displayDate, signPdfWithCertificate } from "./padesCore";
import { CertificatePasswordError, readPkcs12 } from "./pkcs12";
import { cmsTime, parsePdfDate, verifyPdfSignatures } from "./verifyCore";

async function samplePdf(rotation = 0) {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  doc.addPage([595, 842]).setRotation(degrees(rotation));
  doc.setTitle("Agreement");
  return doc.save();
}

async function signer() {
  const { pfxAes } = testIdentity();
  return webCryptoSigner(readPkcs12(pfxAes, "pass-aes"));
}

describe("readPkcs12", () => {
  it("opens legacy 3DES and modern AES-256 files with the exact certificate bytes", () => {
    const { pfx3des, pfxAes, leafDer, caDer } = testIdentity();
    for (const [file, password] of [[pfx3des, "pass-3des"], [pfxAes, "pass-aes"]] as const) {
      const identity = readPkcs12(file, password);
      expect(identity.certificate).toEqual(leafDer);
      expect(identity.chain).toEqual([caDer]);
      expect(identity.privateKeyPkcs8.length).toBeGreaterThan(1000);
    }
  });

  it("reports a wrong password and non-certificate files clearly", () => {
    const { pfxAes } = testIdentity();
    expect(() => readPkcs12(pfxAes, "nope")).toThrow(CertificatePasswordError);
    expect(() => readPkcs12(new TextEncoder().encode("hello"), "x")).toThrow(/not a \.pfx/);
  });

  it("describes the certificate", () => {
    const summary = describeCertificate(testIdentity().leafDer);
    expect(summary).toMatchObject({
      commonName: "Asha Verma",
      organization: "Kitsy Test",
      issuerCommonName: "Test Root CA",
      selfSigned: false,
      keyBits: 2048,
      serialNumber: "0a:1b:2c",
    });
  });
});

describe("signPdfWithCertificate + verifyPdfSignatures", () => {
  it("produces a signature that verifies and covers the whole file", async () => {
    const time = new Date("2026-11-01T10:00:00Z");
    const signed = await signPdfWithCertificate(await samplePdf(), await signer(), {
      reason: "Approved",
      location: "Bengaluru",
      signingTime: time,
    });
    const [check, ...rest] = await verifyPdfSignatures(signed);
    expect(rest).toHaveLength(0);
    expect(check).toMatchObject({
      fieldName: "Signature1",
      subFilter: "ETSI.CAdES.detached",
      intact: true,
      coversWholeFile: true,
      certificateValidAtSigning: true,
      reason: "Approved",
      location: "Bengaluru",
      problem: "",
    });
    expect(check.signer?.commonName).toBe("Asha Verma");
    expect(check.signingTime?.toISOString()).toBe(time.toISOString());
    // The rest of the document survives.
    expect((await PDFDocument.load(signed)).getTitle()).toBe("Agreement");
  });

  it("detects changes inside the signed bytes and content appended afterwards", async () => {
    const signed = await signPdfWithCertificate(await samplePdf(), await signer());
    const tampered = signed.slice();
    // A byte in the header's binary comment: inside the signed range, still parseable.
    tampered[12] = tampered[12] ^ 0x01;
    expect(tampered[12]).not.toBe(signed[12]);
    const [broken] = await verifyPdfSignatures(tampered);
    expect(broken.intact).toBe(false);
    expect(broken.problem).toMatch(/changed after it was signed|does not match/);

    const appended = new Uint8Array(signed.length + 20);
    appended.set(signed);
    appended.set(new TextEncoder().encode("\n% later update\n"), signed.length);
    const [later] = await verifyPdfSignatures(appended);
    expect(later).toMatchObject({ intact: true, coversWholeFile: false });
  });

  it("rejects unsigned syntax written into the /Contents padding (signature wrapping)", async () => {
    const signed = await signPdfWithCertificate(await samplePdf(), await signer());
    const text = new TextDecoder("latin1").decode(signed);
    const match = /\/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);
    expect(match).not.toBeNull();
    const secondStart = Number(match![2]);
    // Keep the gap's length and its < ... > ends; overwrite trailing zero padding.
    const injected = new TextEncoder().encode("> /Reason (Approved by Finance - pay INR 9,50,000) /Location (Mumbai HQ) /X <");
    const wrapped = signed.slice();
    wrapped.set(injected, secondStart - 1 - injected.length);
    expect(wrapped[secondStart - 1]).toBe(0x3e);

    const [check] = await verifyPdfSignatures(wrapped);
    expect(check.intact).toBe(false);
    expect(check.problem).toMatch(/byte range does not match/);
  });

  it("draws a visible box upright on a rotated page", async () => {
    const signed = await signPdfWithCertificate(await samplePdf(90), await signer(), {
      reason: "नमस्ते approval",
      visible: { pageIndex: 1, x: 0.6, y: 0.8, width: 0.35, height: 0.1 },
    });
    expect((await verifyPdfSignatures(signed))[0].intact).toBe(true);
    const doc = await PDFDocument.load(signed);
    const widget = doc.getPage(1).node.Annots()?.lookup(0, PDFDict);
    const rect = widget?.lookup(PDFName.of("Rect"))?.toString();
    const [x1, y1, x2, y2] = rect.replace(/[[\]]/g, "").trim().split(/\s+/).map(Number);
    // On a 90° page the on-screen box is wide; in page space it is tall.
    expect(y2 - y1).toBeGreaterThan(x2 - x1);
  });

  it("refuses to re-sign an already signed PDF", async () => {
    const signed = await signPdfWithCertificate(await samplePdf(), await signer());
    await expect(signPdfWithCertificate(signed, await signer())).rejects.toThrow(/already digitally signed/);
  });

  it("reports unsigned PDFs as having no signatures", async () => {
    expect(await verifyPdfSignatures(await samplePdf())).toEqual([]);
  });
});

describe("buildCmsSignature", () => {
  it("signs exactly the DER-encoded signed attributes it embeds", async () => {
    let seen: Uint8Array = new Uint8Array();
    const base = await signer();
    const cms = await buildCmsSignature(new Uint8Array(32).fill(7), {
      ...base,
      sign: async (data) => {
        seen = data;
        return base.sign(data);
      },
    });
    expect(seen[0]).toBe(0x31); // SET OF
    // The same attribute bytes appear in the CMS under the implicit [0] tag.
    const embedded = new Uint8Array(seen);
    embedded[0] = 0xa0;
    const hay = Array.from(cms).join(",");
    expect(hay.includes(Array.from(embedded).join(","))).toBe(true);
  });
});

describe("dates", () => {
  it("reads CMS signing times as UTCTime and as GeneralizedTime (2050 and later)", () => {
    const early = new Date("2026-11-01T10:00:00Z");
    const late = new Date("2051-03-04T05:06:07Z");
    expect(cmsTime(new asn1js.UTCTime({ valueDate: early }))?.toISOString()).toBe(early.toISOString());
    expect(cmsTime(new asn1js.GeneralizedTime({ valueDate: late }))?.toISOString()).toBe(late.toISOString());
    expect(cmsTime(new asn1js.Integer({ value: 1 }))).toBeNull();
  });

  it("parses PDF dates with offsets", () => {
    expect(parsePdfDate("D:20261101153000+05'30'")?.toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(parsePdfDate("D:20261101100000Z")?.toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(parsePdfDate("garbage")).toBeNull();
  });

  it("formats a readable local signing date", () => {
    expect(displayDate(new Date(2026, 10, 1, 9, 5, 7))).toMatch(/^2026\.11\.01 09:05:07 [+-]\d{2}'\d{2}'$/);
  });
});
