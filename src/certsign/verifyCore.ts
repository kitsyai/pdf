// Inspect and verify the digital signatures in a PDF.
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from "pdf-lib";
import { signatureFields } from "../shared/signatureFields";
import { OID, describeCertificate, type CertificateSummary } from "./cms";

const N = (name: string) => PDFName.of(name);

export type SignatureCheck = {
  fieldName: string;
  subFilter: string;
  /** The signature bytes match the signed content. */
  intact: boolean | null;
  /** The signature covers the whole file (nothing appended after signing). */
  coversWholeFile: boolean;
  signer: CertificateSummary | null;
  /** Certificate validity period includes the claimed signing time. */
  certificateValidAtSigning: boolean | null;
  signingTime: Date | null;
  reason: string;
  location: string;
  /** Why the signature could not be fully checked, if it couldn't. */
  problem: string;
};

const DIGESTS: Record<string, string> = {
  "1.3.14.3.2.26": "SHA-1",
  [OID.sha256]: "SHA-256",
  "2.16.840.1.101.3.4.2.2": "SHA-384",
  "2.16.840.1.101.3.4.2.3": "SHA-512",
};

function text(value: unknown) {
  return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : "";
}

/** "D:20261101120509+05'30'" -> Date. */
export function parsePdfDate(value: string) {
  const match = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz]|[+-]\d{2}'?\d{2}'?)?/.exec(value || "");
  if (!match) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00", tz = "Z"] = match;
  let offset = "Z";
  if (/^[+-]/.test(tz)) {
    const digits = tz.replace(/'/g, "");
    offset = `${digits.slice(0, 3)}:${digits.slice(3, 5) || "00"}`;
  }
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Length of a DER value starting at 0 (the Contents hex is zero-padded). */
function derLength(bytes: Uint8Array) {
  if (bytes.length < 2) return 0;
  const first = bytes[1];
  if (first < 0x80) return 2 + first;
  const count = first & 0x7f;
  let length = 0;
  for (let i = 0; i < count; i += 1) length = length * 256 + bytes[2 + i];
  return 2 + count + length;
}

function attributeValue(signerInfo: pkijs.SignerInfo, oid: string) {
  return signerInfo.signedAttrs?.attributes.find((attribute) => attribute.type === oid)?.values[0];
}

async function checkSignature(file: Uint8Array, name: string, dict: PDFDict): Promise<SignatureCheck> {
  const check: SignatureCheck = {
    fieldName: name,
    subFilter: (dict.lookup(N("SubFilter")) as PDFName | undefined)?.decodeText?.() ?? "",
    intact: null,
    coversWholeFile: false,
    signer: null,
    certificateValidAtSigning: null,
    signingTime: parsePdfDate(text(dict.lookup(N("M")))),
    reason: text(dict.lookup(N("Reason"))),
    location: text(dict.lookup(N("Location"))),
    problem: "",
  };

  const byteRange = dict.lookup(N("ByteRange"));
  const contents = dict.lookup(N("Contents"));
  const range = byteRange instanceof PDFArray
    ? byteRange.asArray().map((item) => (item instanceof PDFNumber ? item.asNumber() : NaN))
    : [];
  if (range.length !== 4 || range.some((value) => !Number.isInteger(value) || value < 0) || !(contents instanceof PDFHexString || contents instanceof PDFString)) {
    check.problem = "The signature is incomplete or malformed.";
    return check;
  }

  const [start, firstLength, secondStart, secondLength] = range;
  const structureOk =
    start === 0 &&
    firstLength < secondStart &&
    secondStart + secondLength <= file.length &&
    file[firstLength] === 0x3c /* < */ &&
    file[secondStart - 1] === 0x3e; /* > */
  check.coversWholeFile = structureOk && secondStart + secondLength === file.length;
  if (!structureOk) {
    check.intact = false;
    check.problem = "The signed byte range does not match the file.";
    return check;
  }

  if (!/^(ETSI\.CAdES\.detached|adbe\.pkcs7\.detached)$/.test(check.subFilter)) {
    check.problem = `The ${check.subFilter || "unknown"} signature format is not supported here.`;
    return check;
  }

  const signed = new Uint8Array(firstLength + secondLength);
  signed.set(file.subarray(0, firstLength), 0);
  signed.set(file.subarray(secondStart, secondStart + secondLength), firstLength);

  const raw = contents.asBytes();
  const der = raw.subarray(0, derLength(raw));
  let signedData: pkijs.SignedData;
  try {
    const contentInfo = pkijs.ContentInfo.fromBER(der.slice().buffer);
    signedData = new pkijs.SignedData({ schema: contentInfo.content });
  } catch {
    check.intact = false;
    check.problem = "The signature data could not be read.";
    return check;
  }

  const signerInfo = signedData.signerInfos[0];
  const sid = signerInfo?.sid;
  const signerCert = (signedData.certificates || []).find(
    (cert) =>
      cert instanceof pkijs.Certificate &&
      sid instanceof pkijs.IssuerAndSerialNumber &&
      cert.issuer.isEqual(sid.issuer) &&
      cert.serialNumber.isEqual(sid.serialNumber)
  ) as pkijs.Certificate | undefined;
  if (signerCert) {
    check.signer = describeCertificate(new Uint8Array(signerCert.toSchema().toBER()));
  }

  const signingTimeAttr = attributeValue(signerInfo, OID.signingTime);
  if (!check.signingTime && signingTimeAttr instanceof asn1js.UTCTime) check.signingTime = signingTimeAttr.toDate();
  if (check.signer && check.signingTime) {
    check.certificateValidAtSigning =
      check.signingTime >= check.signer.notBefore && check.signingTime <= check.signer.notAfter;
  }

  const digestName = DIGESTS[signerInfo.digestAlgorithm.algorithmId];
  if (!digestName) {
    check.problem = "The signature uses an unsupported digest algorithm.";
    return check;
  }

  try {
    const result = await signedData.verify({
      signer: 0,
      data: signed.slice().buffer,
      checkChain: false,
      extendedMode: true,
    });
    check.intact = Boolean(result.signatureVerified);
    if (!check.intact) check.problem = "The document was changed after it was signed, or the signature is corrupt.";
  } catch (error) {
    check.intact = false;
    check.problem =
      error?.code === 15 || /message digest/i.test(String(error?.message || error?.date || ""))
        ? "The document was changed after it was signed."
        : "The signature does not match the document or its certificate.";
  }
  return check;
}

export async function verifyPdfSignatures(bytes: ArrayBuffer | Uint8Array) {
  const file = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let doc: PDFDocument;
  try {
    // Signature /Contents are never encrypted, so encrypted PDFs can be read too.
    doc = await PDFDocument.load(file, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new Error("This file is not a readable PDF.");
  }

  const checks: SignatureCheck[] = [];
  for (const field of signatureFields(doc)) {
    if (field.value) checks.push(await checkSignature(file, field.name, field.value));
  }
  return checks;
}
